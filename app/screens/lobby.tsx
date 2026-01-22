import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  FlatList,
  Image,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWallet } from '@/contexts/WalletContext';
import { getActiveBattles, type ActiveBattle, formatTimeRemaining } from '@/utils/battles';
import { Connection } from '@solana/web3.js';
import { RPC_ENDPOINT, COMMITMENT } from '@/config/network';

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

export default function LobbyScreen() {
  const insets = useSafeAreaInsets();
  const { publicKey, connected, balance, connect, disconnect } = useWallet();
  const [battles, setBattles] = useState<ActiveBattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<'WaitingForChallenger' | 'WaitingCreatorReveal'>('WaitingForChallenger');
  const [showWalletMenu, setShowWalletMenu] = useState(false);

  // 获取所有对战
  const fetchBattles = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      const activeBattles = await getActiveBattles(connection);

      // 按剩余时间排序，即将过期的排在最前面
      const sortedBattles = activeBattles.sort((a, b) => {
        return a.expiresInSeconds - b.expiresInSeconds;
      });

      setBattles(sortedBattles);
    } catch (error) {
      console.error('Failed to fetch battles:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, []);

  // 初始加载
  useEffect(() => {
    fetchBattles(true);
  }, [fetchBattles]);

  // 自动刷新battle列表（每20秒）
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      console.log('🔄 Auto refreshing battles...');
      fetchBattles(false);
    }, 20000);

    return () => clearInterval(refreshInterval);
  }, [fetchBattles]);

  // 实时更新倒计时
  useEffect(() => {
    if (battles.length === 0) return;

    const updateTimer = setInterval(() => {
      setBattles(prevBattles => {
        const updated = prevBattles.map(battle => {
          const remainingSeconds = Math.max(0, battle.expiresInSeconds - 1);
          const timeRemaining = formatTimeRemaining(remainingSeconds);

          return {
            ...battle,
            expiresInSeconds: remainingSeconds,
            timeRemaining,
          };
        });

        // 保持排序：即将过期的排在最前面
        return updated.sort((a, b) => a.expiresInSeconds - b.expiresInSeconds);
      });
    }, 1000);

    return () => clearInterval(updateTimer);
  }, [battles.length > 0]);

  const filteredBattles = battles.filter(b => b.state === selectedFilter);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const handleDisconnect = async () => {
    setShowWalletMenu(false);
    await disconnect();
  };

  const renderBattleCard = ({ item }: { item: ActiveBattle }) => (
    <TouchableOpacity
      style={styles.battleCard}
      onPress={() => router.push(`/battle/${item.battlePda}`)}>
      <View style={styles.cardHeader}>
        <Text style={styles.gameType}>{item.gameTypeDisplay}</Text>
        <View style={[styles.stateBadge, item.state === 'WaitingForChallenger' ? styles.waitingBadge : styles.revealBadge]}>
          <Text style={styles.stateText}>{item.stateDisplay}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.amountContainer}>
          <Text style={styles.amountLabel}>Bet Amount</Text>
          <Text style={styles.amount}>{item.betAmountSol} SOL</Text>
        </View>
        <View style={styles.creatorContainer}>
          <Text style={styles.creatorLabel}>Creator</Text>
          <Text style={styles.creator} numberOfLines={1}>
            {item.creator.slice(0, 4)}...{item.creator.slice(-4)}
          </Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.timeLabel}>Time Remaining:</Text>
        <Text style={styles.time}>{item.timeRemaining}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require('@/assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>Battle Arena (testnet)</Text>
        </View>
        <View style={styles.headerRight}>
          {connected ? (
            <TouchableOpacity
              style={styles.addressButton}
              onPress={() => setShowWalletMenu(true)}>
              <Text style={styles.addressText}>
                {publicKey ? formatAddress(publicKey.toBase58()) : ''}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.walletButton}
              onPress={connect}>
              <Text style={styles.walletButtonText}>Connect Wallet</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Balance Section */}
      <View style={styles.balanceSection}>
        <View style={styles.balanceContainer}>
          <View style={styles.balanceIcon}>
            <Image
              source={require('@/assets/images/wallet.png')}
              style={styles.balanceIconImage}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.balanceLabel}>Your Balance</Text>
            <Text style={styles.balance}>{balance.toFixed(2)} SOL</Text>
          </View>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => fetchBattles(false)}
            disabled={isRefreshing}>
            <Text style={styles.buttonText}>
              {isRefreshing ? '🔄' : '🔄'} Refresh
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.historyButton}
            onPress={() => router.push('/history')}>
            <Text style={styles.buttonText}>📜 History</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Battle List Header with Filter */}
      <View style={styles.battleListSection}>
        <View style={styles.battleListHeader}>
          <Text style={styles.battleListTitle}>Active Battles</Text>
          <View style={styles.onlineBadge}>
            <Text style={styles.onlineText}>{battles.length} Online</Text>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={[styles.filterTab, selectedFilter === 'WaitingForChallenger' && styles.activeFilterTab]}
            onPress={() => setSelectedFilter('WaitingForChallenger')}>
            <Text style={[styles.filterText, selectedFilter === 'WaitingForChallenger' && styles.activeFilterText]}>
              👤 Waiting
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, selectedFilter === 'WaitingCreatorReveal' && styles.activeFilterTab]}
            onPress={() => setSelectedFilter('WaitingCreatorReveal')}>
            <Text style={[styles.filterText, selectedFilter === 'WaitingCreatorReveal' && styles.activeFilterText]}>
              👁️ Reveal
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading battles...</Text>
        </View>
      ) : filteredBattles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No {selectedFilter === 'WaitingForChallenger' ? 'waiting' : 'revealing'} battles found
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredBattles}
          renderItem={renderBattleCard}
          keyExtractor={(item) => item.battlePda}
          contentContainerStyle={styles.battleList}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => fetchBattles(false)} />
          }
        />
      )}

      {/* Create Battle FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => router.push('/create')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Wallet Menu Modal */}
      <Modal
        visible={showWalletMenu}
        transparent={true}
        animationType="none"
        onRequestClose={() => setShowWalletMenu(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowWalletMenu(false)}>
          <View style={styles.walletMenu}>
            <View style={styles.walletMenuItem}>
              <Text style={styles.walletMenuLabel}>Wallet Address</Text>
              <Text style={styles.walletMenuAddress}>
                {publicKey ? publicKey.toBase58() : ''}
              </Text>
            </View>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.walletMenuItem}
              onPress={handleDisconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addressButton: {
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addressText: {
    color: '#14F195',
    fontSize: 12,
    fontWeight: '600',
  },
  connectedBadge: {
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectedText: {
    color: '#14F195',
    fontSize: 10,
    fontWeight: 'bold',
  },
  walletButton: {
    backgroundColor: '#283639',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  walletButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 100,
  },
  walletMenu: {
    backgroundColor: '#1c2527',
    borderRadius: 12,
    marginRight: 16,
    minWidth: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  walletMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  walletMenuLabel: {
    color: '#9db4b9',
    fontSize: 12,
    marginBottom: 4,
  },
  walletMenuAddress: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 16,
  },
  disconnectText: {
    color: '#FF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  balanceSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(28, 37, 39, 0.4)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  balanceIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  balanceIconImage: {
    width: 24,
    height: 24,
  },
  balanceLabel: {
    color: '#9db4b9',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  balance: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  refreshButton: {
    backgroundColor: '#283639',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  historyButton: {
    backgroundColor: '#283639',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterTab: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#283639',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilterTab: {
    backgroundColor: '#13C8F4',
  },
  filterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  activeFilterText: {
    color: '#0d1117',
    fontWeight: 'bold',
  },
  battleListSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  battleListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  battleListTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  onlineBadge: {
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  onlineText: {
    color: '#14F195',
    fontSize: 10,
    fontWeight: 'bold',
  },
  loadingContainer: {
    padding: 48,
    alignItems: 'center',
  },
  loadingText: {
    color: '#9db4b9',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: '#9db4b9',
    fontSize: 14,
  },
  battleList: {
    padding: 16,
    gap: 16,
  },
  battleCard: {
    backgroundColor: '#1c2527',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  gameType: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  waitingBadge: {
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
  },
  revealBadge: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
  },
  stateText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardBody: {
    marginBottom: 12,
  },
  amountContainer: {
    marginBottom: 8,
  },
  amountLabel: {
    color: '#9db4b9',
    fontSize: 12,
    marginBottom: 4,
  },
  amount: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  creatorContainer: {
    marginBottom: 8,
  },
  creatorLabel: {
    color: '#9db4b9',
    fontSize: 12,
    marginBottom: 4,
  },
  creator: {
    color: '#13C8F4',
    fontSize: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  timeLabel: {
    color: '#9db4b9',
    fontSize: 12,
  },
  time: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#13C8F4',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#13C8F4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 8,
  },
  fabText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#0d1117',
  },
});
