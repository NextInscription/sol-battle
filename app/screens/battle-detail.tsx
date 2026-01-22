import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useWallet } from '@/contexts/WalletContext';
import { Connection, PublicKey } from '@solana/web3.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { RPC_ENDPOINT, COMMITMENT } from '@/config/network';

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);

type BattleState = 'WaitingChallenger' | 'WaitingCreatorReveal' | 'BothRevealed' | 'Settled';
type GameType = 'CoinFlip' | 'DiceRoll';

interface BattleData {
  battlePda: string;
  battleId: number;
  creator: string;
  challenger: string | null;
  betAmountSol: number;
  gameType: GameType;
  state: BattleState;
  winner: string | null;
  creatorRevealed: boolean;
  challengerRevealed: boolean;
  isCreator?: boolean;
}

const gameTypeLabels: Record<GameType, string> = {
  CoinFlip: 'Flip Card Game',
};

const stateLabels: Record<BattleState, string> = {
  WaitingChallenger: 'Waiting for Challenger',
  WaitingCreatorReveal: 'Waiting for Creator Reveal',
  BothRevealed: 'Both Revealed',
  Settled: 'Settled',
};

export default function BattleDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { publicKey, connected, joinBattle, revealSeed } = useWallet();
  const battlePda = params.battlePda as string;

  const [battle, setBattle] = useState<BattleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinLoading, setJoinLoading] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [seedInput, setSeedInput] = useState('');

  useEffect(() => {
    if (battlePda) {
      fetchBattleDetails();
    }
  }, [battlePda]);

  const handleJoinBattle = async () => {
    if (!connected || !publicKey) {
      Alert.alert('Error', 'Please connect your wallet first');
      return;
    }

    if (!battle) return;

    try {
      setJoinLoading(true);
      const result = await joinBattle(battlePda, battle.betAmountSol);

      Alert.alert(
        'Success',
        `Joined battle successfully!\nSignature: ${result.signature.slice(0, 8)}...${result.signature.slice(-8)}`,
        [{ text: 'OK', onPress: () => fetchBattleDetails() }]
      );
    } catch (error: any) {
      console.error('Failed to join battle:', error);

      // Handle wallet cancellation specifically
      if (error?.message?.includes('Cancellation') || error?.message?.includes('cancelled')) {
        Alert.alert('Cancelled', 'Transaction was cancelled');
      } else if (error?.message) {
        Alert.alert('Error', `Failed to join battle: ${error.message}`);
      } else {
        Alert.alert('Error', 'Failed to join battle: Unknown error');
      }
    } finally {
      setJoinLoading(false);
    }
  };

  const handleRevealSeed = async () => {
    if (!connected || !publicKey) {
      Alert.alert('Error', 'Please connect your wallet first');
      return;
    }

    if (!battle) return;

    // Validate seed format
    const cleanedInput = seedInput.trim().toLowerCase();
    if (cleanedInput.length !== 64) {
      Alert.alert('Error', 'Seed must be exactly 64 hex characters.');
      return;
    }

    // Validate hex characters
    if (!/^[0-9a-f]{64}$/.test(cleanedInput)) {
      Alert.alert('Error', 'Seed must contain only hexadecimal characters (0-9, a-f).');
      return;
    }

    try {
      setRevealLoading(true);

      // Convert hex string to Uint8Array
      const seed = new Uint8Array(
        cleanedInput.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16))
      );

      const signature = await revealSeed(battlePda, seed);

      Alert.alert(
        'Success',
        `Seed revealed successfully!\nSignature: ${signature.slice(0, 8)}...${signature.slice(-8)}`,
        [{ text: 'OK', onPress: () => {
          setSeedInput(''); // Clear input after success
          fetchBattleDetails();
        }}]
      );
    } catch (error: any) {
      console.error('Failed to reveal seed:', error);

      if (error?.message?.includes('Cancellation') || error?.message?.includes('cancelled')) {
        Alert.alert('Cancelled', 'Transaction was cancelled');
      } else if (error?.message) {
        Alert.alert('Error', `Failed to reveal seed: ${error.message}`);
      } else {
        Alert.alert('Error', 'Failed to reveal seed: Unknown error');
      }
    } finally {
      setRevealLoading(false);
    }
  };

  const fetchBattleDetails = async () => {
    if (!battlePda) return;

    try {
      setLoading(true);
      const battlePubkey = new PublicKey(battlePda);
      const accountInfo = await connection.getAccountInfo(battlePubkey);

      if (!accountInfo) {
        console.error('Battle not found');
        return;
      }

      const data = accountInfo.data as Buffer;
      let offset = 8; // 跳过 discriminator

      const battleId = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
      offset += 8;

      const creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;

      const challengerTag = data.readUInt8(offset);
      offset += 1;
      let challenger = null;
      if (challengerTag !== 0) {
        challenger = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      }

      const betAmountLamports = new BN(data.subarray(offset, offset + 8), 'le');
      const betAmountSol = parseFloat(betAmountLamports.toString()) / LAMPORTS_PER_SOL;
      offset += 8;

      offset += 32; // commit_creator

      const commitChallengerTag = data.readUInt8(offset);
      offset += 1;
      if (commitChallengerTag !== 0) offset += 32;

      const seedCreatorTag = data.readUInt8(offset);
      offset += 1;
      const creatorRevealed = seedCreatorTag === 1;
      if (seedCreatorTag !== 0) offset += 32; // Skip seed_creator data if present

      const seedChallengerTag = data.readUInt8(offset);
      offset += 1;
      const challengerRevealed = seedChallengerTag === 1;
      if (seedChallengerTag !== 0) offset += 32; // Skip seed_challenger data if present

      // game_type (enum = 1 byte)
      const gameTypeValue = data.readUInt8(offset);
      offset += 1;
      const gameType: GameType = gameTypeValue === 0 ? 'CoinFlip' : 'DiceRoll';

      // state (enum = 1 byte)
      const stateValue = data.readUInt8(offset);
      offset += 1;
      const state: BattleState = stateValue === 0 ? 'WaitingChallenger' : stateValue === 1 ? 'WaitingCreatorReveal' : stateValue === 2 ? 'BothRevealed' : 'Settled';

      // winner (option pubkey = 1 byte tag + 32 bytes if present)
      const winnerTag = data.readUInt8(offset);
      offset += 1;
      let winner = null;
      if (winnerTag !== 0) {
        winner = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      }

      // created_at_slot (u64 = 8 bytes)
      offset += 8;

      // joined_at_slot (option u64 = 1 byte tag + 8 bytes if present)
      const joinedAtTag = data.readUInt8(offset);
      offset += 1;
      if (joinedAtTag !== 0) {
        offset += 8;
      }

      // config_snapshot (struct: fee_bps(u16) + reveal_timeout_slots(u64) + no_challenger_timeout_slots(u64))
      offset += 2; // fee_bps
      offset += 8; // reveal_timeout_slots
      offset += 8; // no_challenger_timeout_slots

      // bump (1 byte)
      offset += 1;

      const isCreator = publicKey ? creator === publicKey.toBase58() : undefined;

      setBattle({
        battlePda,
        battleId,
        creator,
        challenger,
        betAmountSol,
        gameType,
        state,
        winner,
        creatorRevealed,
        challengerRevealed,
        isCreator,
      });
    } catch (error) {
      console.error('Failed to fetch battle details:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#13C8F4" />
          <Text style={styles.loadingText}>Loading battle details...</Text>
        </View>
      </View>
    );
  }

  if (!battle) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Text style={styles.headerTitle}>Battle Details</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Battle not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      {/* <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => (window as any).history?.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Battle Details</Text>
        <View style={styles.placeholder} />
      </View> */}

      <ScrollView style={styles.content}>
        {/* Game Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Game Type</Text>
          <Text style={styles.gameType}>{gameTypeLabels[battle.gameType]}</Text>
        </View>

        {/* State */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={[styles.stateBadge, styles.largeStateBadge]}>
            <Text style={styles.stateText}>{stateLabels[battle.state]}</Text>
          </View>
        </View>

        {/* Bet Amount */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bet Amount</Text>
          <Text style={styles.betAmount}>{battle.betAmountSol.toFixed(2)} SOL</Text>
        </View>

        {/* Players */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Players</Text>
          <View style={styles.playerRow}>
            <Text style={styles.playerLabel}>Creator:</Text>
            <Text style={styles.playerAddress}>
              {battle.isCreator ? '(You) ' : ''}{formatAddress(battle.creator)}
            </Text>
          </View>
          {battle.challenger && (
            <View style={styles.playerRow}>
              <Text style={styles.playerLabel}>Challenger:</Text>
              <Text style={styles.playerAddress}>
                {battle.isCreator === false ? '(You) ' : ''}{formatAddress(battle.challenger)}
              </Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {!battle.isCreator && battle.state === 'WaitingChallenger' && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleJoinBattle}
              disabled={joinLoading}
            >
              {joinLoading ? (
                <ActivityIndicator color="#0d1117" />
              ) : (
                <Text style={styles.actionButtonText}>Join Battle</Text>
              )}
            </TouchableOpacity>
          )}
          {/* Creator 需要在 WaitingCreatorReveal 状态揭示种子，且还未揭示 */}
          {battle.isCreator && battle.state === 'WaitingCreatorReveal' && !battle.creatorRevealed && (
            <>
              <TextInput
                style={styles.seedInput}
                placeholder="Enter your seed (64 hex characters)"
                placeholderTextColor="#9db4b9"
                value={seedInput}
                onChangeText={(text) => setSeedInput(text.trim().toLowerCase())}
                autoCapitalize="none"
                autoCorrect={false}
                selectTextOnFocus
              />
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  seedInput.length !== 64 && styles.actionButtonDisabled
                ]}
                onPress={handleRevealSeed}
                disabled={revealLoading || seedInput.length !== 64}
              >
                {revealLoading ? (
                  <ActivityIndicator color="#0d1117" />
                ) : (
                  <Text style={styles.actionButtonText}>Reveal Seed</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  backButton: {
    color: '#13C8F4',
    fontSize: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 50,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#9db4b9',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#FF4444',
    fontSize: 16,
  },
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: '#1c2527',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  sectionTitle: {
    color: '#9db4b9',
    fontSize: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  gameType: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  stateBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  largeStateBadge: {
    backgroundColor: 'rgba(20, 241, 149, 0.1)',
  },
  stateText: {
    color: '#14F195',
    fontSize: 14,
    fontWeight: 'bold',
  },
  betAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  playerLabel: {
    color: '#9db4b9',
    fontSize: 14,
  },
  playerAddress: {
    color: '#13C8F4',
    fontSize: 14,
    fontWeight: '600',
  },
  winnerText: {
    color: '#14F195',
    fontSize: 18,
    fontWeight: 'bold',
  },
  actions: {
    margin: 16,
    marginTop: 20,
  },
  seedInput: {
    backgroundColor: '#283639',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 12,
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: '#13C8F4',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: '#283639',
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#0d1117',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
