import { COMMITMENT, PROGRAM_ID, RPC_ENDPOINT } from "@/config/network";
import { useWallet } from "@/contexts/WalletContext";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const connection = new Connection(RPC_ENDPOINT, COMMITMENT);
const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

type BattleState =
  | "WaitingForChallenger"
  | "WaitingCreatorReveal"
  | "BothRevealed"
  | "Settled";
type GameType = "CoinFlip" | "DiceRoll";

interface HistoryBattle {
  battlePda: string;
  battleId: string; // 改用字符串存储，避免 53 位限制
  creator: string;
  challenger: string | null;
  betAmountSol: number;
  gameType: GameType;
  state: BattleState;
  winner: string | null;
  isCreator: boolean;
  result?: "Won" | "Lost" | "In Progress" | "Refunded";
  createdAtSlot?: number;
  revealTimeoutSlots?: number;
  noChallengerTimeoutSlots?: number;
  joinedAtSlot?: number;
}

const gameStateLabels: Record<BattleState, string> = {
  WaitingForChallenger: "Waiting for Challenger",
  WaitingCreatorReveal: "Waiting Reveal",
  BothRevealed: "Both Revealed",
  Settled: "Settled",
};

const gameTypeLabels: Record<GameType, string> = {
  CoinFlip: "Flip Card",
  DiceRoll: "Dice Roll",
};

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { publicKey, claimRefund, claimTimeoutWin } = useWallet();
  const [battles, setBattles] = useState<HistoryBattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [currentSlot, setCurrentSlot] = useState<number>(0);

  useEffect(() => {
    if (publicKey) {
      fetchHistory();
    }
  }, [publicKey]);

  const fetchHistory = async () => {
    if (!publicKey) {
      console.log("History: No public key");
      return;
    }

    try {
      setLoading(true);
      console.log("History: Fetching for", publicKey.toBase58());

      // 获取当前slot
      const slot = await connection.getSlot();
      setCurrentSlot(slot);
      console.log("History: Current slot", slot);

      // 获取所有 program accounts
      const accounts = await connection.getProgramAccounts(PROGRAM_ID_PUBKEY);
      console.log("History: Found", accounts.length, "accounts");

      const historyBattles: HistoryBattle[] = [];

      for (const acc of accounts) {
        try {
          const data = acc.account.data as Buffer;

          // 检查 discriminator - Battle 账户的 discriminator
          if (data.length < 8) {
            console.log("Skipping: data too short");
            continue;
          }

          const discriminator = data.subarray(0, 8);
          const battleDiscriminator = [81, 148, 121, 71, 63, 166, 116, 24];

          // Compare byte by byte since discriminator is Uint8Array
          const isBattleAccount = discriminator.every((byte, index) => byte === battleDiscriminator[index]);
          if (!isBattleAccount) {
            console.log("Skipping: not a Battle account");
            continue;
          }

          let offset = 8; // 跳过 discriminator

          // 检查是否有足够的数据
          if (data.length < offset + 8 + 32 + 1 + 8 + 32 + 1 + 1 + 1 + 1 + 1 + 1 + 8 + 1 + 8 + 2 + 8 + 8 + 1) {
            console.log("Skipping: data too short for Battle");
            continue;
          }

          const battleId = new BN(
            data.subarray(offset, offset + 8),
            "le",
          ).toString();
          offset += 8;

          const creator = new PublicKey(
            data.subarray(offset, offset + 32),
          ).toBase58();
          offset += 32;

          const challengerTag = data.readUInt8(offset);
          offset += 1;
          let challenger = null;
          if (challengerTag !== 0) {
            challenger = new PublicKey(
              data.subarray(offset, offset + 32),
            ).toBase58();
            offset += 32;
          }

          const betAmountLamports = new BN(
            data.subarray(offset, offset + 8),
            "le",
          );
          const betAmountSol =
            parseFloat(betAmountLamports.toString()) / LAMPORTS_PER_SOL;
          offset += 8;

          offset += 32; // commit_creator

          const commitChallengerTag = data.readUInt8(offset);
          offset += 1;
          if (commitChallengerTag !== 0) offset += 32;

          const seedCreatorTag = data.readUInt8(offset);
          offset += 1;
          if (seedCreatorTag !== 0) offset += 32; // Skip seed_creator if present

          const seedChallengerTag = data.readUInt8(offset);
          offset += 1;
          if (seedChallengerTag !== 0) offset += 32; // Skip seed_challenger if present

          // game_type (enum = 1 byte)
          const gameTypeValue = data.readUInt8(offset);
          offset += 1;
          const gameType: GameType =
            gameTypeValue === 0 ? "CoinFlip" : "DiceRoll";

          // state (enum = 1 byte)
          const stateValue = data.readUInt8(offset);
          offset += 1;
          const state: BattleState =
            stateValue === 0
              ? "WaitingForChallenger"
              : stateValue === 1
                ? "WaitingCreatorReveal"
                : stateValue === 2
                  ? "BothRevealed"
                  : "Settled";

          // winner (option pubkey = 1 byte tag + 32 bytes if present)
          const winnerTag = data.readUInt8(offset);
          offset += 1;
          let winner = null;
          if (winnerTag !== 0) {
            winner = new PublicKey(
              data.subarray(offset, offset + 32),
            ).toBase58();
            offset += 32;
          }

          // created_at_slot (u64 = 8 bytes)
          const createdAtSlot = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
          offset += 8;

          // joined_at_slot (option u64 = 1 byte tag + 8 bytes if present)
          const joinedAtTag = data.readUInt8(offset);
          offset += 1;
          let joinedAtSlot = null;
          if (joinedAtTag !== 0) {
            joinedAtSlot = new BN(data.subarray(offset, offset + 8), "le").toNumber();
            offset += 8;
          }

          // config_snapshot (struct: fee_bps(u16) + reveal_timeout_slots(u64) + no_challenger_timeout_slots(u64))
          offset += 2; // fee_bps
          const revealTimeoutSlots = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
          offset += 8;
          const noChallengerTimeoutSlots = new BN(data.subarray(offset, offset + 8), 'le').toNumber();
          offset += 8;

          // bump (1 byte)
          offset += 1;

          // 只包含与当前用户相关的对战
          const isCreator = creator === publicKey.toBase58();
          const isChallenger = challenger === publicKey.toBase58();

          if (isCreator || isChallenger) {
            let result: "Won" | "Lost" | "In Progress" | "Refunded" =
              "In Progress";

            if (state === "Settled") {
              if (winner === publicKey.toBase58()) {
                result = "Won";
              } else {
                result = "Lost";
              }
            } else if (state === "WaitingForChallenger" && isCreator) {
              result = "Refunded";
            }

            historyBattles.push({
              battlePda: acc.pubkey.toBase58(),
              battleId,
              creator,
              challenger,
              betAmountSol,
              gameType,
              state,
              winner,
              isCreator,
              result,
              createdAtSlot,
              revealTimeoutSlots,
              noChallengerTimeoutSlots,
              joinedAtSlot,
            });
          }
        } catch (parseError) {
          console.error(
            "History: Failed to parse battle",
            acc.pubkey.toBase58(),
            parseError,
          );
        }
      }

      console.log("History: Parsed", historyBattles.length, "battles");
      setBattles(historyBattles);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  // 检查哪些 battle 可以执行操作
  const canClaimRefund = (battle: HistoryBattle): boolean => {
    // 必须是创建者
    if (!battle.isCreator) return false;

    // 状态必须是 WaitingForChallenger（即没有挑战者加入）
    if (battle.state !== 'WaitingForChallenger') return false;

    // 确保没有挑战者
    if (battle.challenger !== null) return false;

    // 检查超时
    if (!battle.createdAtSlot || !battle.noChallengerTimeoutSlots) return false;

    const deadlineSlot = battle.createdAtSlot + battle.noChallengerTimeoutSlots;
    return currentSlot >= deadlineSlot;
  };

  const canClaimTimeoutWin = (battle: HistoryBattle): boolean => {
    // 必须是挑战者（不是创建者）
    if (battle.isCreator) return false;

    // 状态必须是 WaitingCreatorReveal（挑战者已加入，等待创建者揭示）
    if (battle.state !== 'WaitingCreatorReveal') return false;

    // 检查超时
    if (!battle.joinedAtSlot || !battle.revealTimeoutSlots) return false;

    const deadlineSlot = battle.joinedAtSlot + battle.revealTimeoutSlots;
    return currentSlot >= deadlineSlot;
  };

  const handleClaimRefund = async (battle: HistoryBattle) => {
    if (!claimRefund) {
      Alert.alert('Error', 'claimRefund method not available');
      return;
    }

    try {
      setActionLoading(battle.battlePda);
      const signature = await claimRefund(battle.battlePda);
      Alert.alert('Success', `Refund claimed!\nSignature: ${signature.slice(0, 8)}...${signature.slice(-8)}`);
      await fetchHistory();
    } catch (error: any) {
      console.error('Failed to claim refund:', error);
      Alert.alert('Error', `Failed to claim refund: ${error.message || 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleClaimTimeoutWin = async (battle: HistoryBattle) => {
    if (!claimTimeoutWin) {
      Alert.alert('Error', 'claimTimeoutWin method not available');
      return;
    }

    try {
      setActionLoading(battle.battlePda);
      const signature = await claimTimeoutWin(battle.battlePda);
      Alert.alert('Success', `Timeout win claimed!\nSignature: ${signature.slice(0, 8)}...${signature.slice(-8)}`);
      await fetchHistory();
    } catch (error: any) {
      console.error('Failed to claim timeout win:', error);
      Alert.alert('Error', `Failed to claim timeout win: ${error.message || 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const renderBattleCard = ({ item }: { item: HistoryBattle }) => {
    const handlePress = () => {
      router.push(`/battle/${item.battlePda}`);
    };

    return (
      <TouchableOpacity
        style={styles.battleCard}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.gameType}>{gameTypeLabels[item.gameType]}</Text>
          <View style={[styles.stateBadge, styles.historyBadge]}>
            <Text style={styles.stateText}>{gameStateLabels[item.state]}</Text>
          </View>
        </View>

      <View style={styles.cardBody}>
        <View style={styles.row}>
          <Text style={styles.label}>Bet:</Text>
          <Text style={styles.value}>{item.betAmountSol.toFixed(2)} SOL</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Role:</Text>
          <Text style={styles.value}>
            {item.isCreator ? "Creator" : "Challenger"}
          </Text>
        </View>
        {item.challenger && (
          <View style={styles.row}>
            <Text style={styles.label}>Opponent:</Text>
            <Text style={styles.value}>
              {item.isCreator
                ? item.challenger.slice(0, 4) +
                  "..." +
                  item.challenger.slice(-4)
                : item.creator.slice(0, 4) + "..." + item.creator.slice(-4)}
            </Text>
          </View>
        )}
      </View>

      {item.result !== "In Progress" && (
        <View style={styles.resultSection}>
          <Text
            style={[styles.resultText, item.result === "Won" && styles.winText]}
          >
            {item.result === "Won" ? "🏆 Victory" : "💔 Defeat"}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      {canClaimRefund(item) && (
        <TouchableOpacity
          style={[styles.actionButton, styles.refundButton]}
          onPress={(e) => {
            e.stopPropagation();
            handleClaimRefund(item);
          }}
          disabled={actionLoading === item.battlePda}
        >
          {actionLoading === item.battlePda ? (
            <ActivityIndicator color="#0d1117" />
          ) : (
            <Text style={styles.actionButtonText}>Claim Refund</Text>
          )}
        </TouchableOpacity>
      )}

      {canClaimTimeoutWin(item) && (
        <TouchableOpacity
          style={[styles.actionButton, styles.timeoutWinButton]}
          onPress={(e) => {
            e.stopPropagation();
            handleClaimTimeoutWin(item);
          }}
          disabled={actionLoading === item.battlePda}
        >
          {actionLoading === item.battlePda ? (
            <ActivityIndicator color="#0d1117" />
          ) : (
            <Text style={styles.actionButtonText}>Claim Timeout Win</Text>
          )}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

  return (
    <View style={styles.container}>
      {/* Header */}
      {/* <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => (window as any).history?.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Battle History</Text>
        <View style={styles.placeholder} />
      </View> */}

      {/* Content */}
      {!publicKey ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Please connect your wallet first</Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#13C8F4" />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      ) : battles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No battle history found</Text>
        </View>
      ) : (
        <FlatList
          data={battles}
          renderItem={renderBattleCard}
          keyExtractor={(item) => item.battlePda}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  backButton: {
    color: "#13C8F4",
    fontSize: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  placeholder: {
    width: 50,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#9db4b9",
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#9db4b9",
    fontSize: 16,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  battleCard: {
    backgroundColor: "#1c2527",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  gameType: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  historyBadge: {
    backgroundColor: "rgba(255, 193, 7, 0.1)",
  },
  stateText: {
    fontSize: 10,
    fontWeight: "bold",
  },
  cardBody: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: "#9db4b9",
    fontSize: 14,
  },
  value: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  resultSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
  },
  resultText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#FF4444",
  },
  winText: {
    color: "#14F195",
  },
  actionButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  refundButton: {
    backgroundColor: "rgba(255, 193, 7, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 193, 7, 0.3)",
  },
  timeoutWinButton: {
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.3)",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
});
