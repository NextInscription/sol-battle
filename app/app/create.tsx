import { useWallet } from "@/contexts/WalletContext";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function CreateBattleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { publicKey, connected, createBattle, balance } = useWallet();

  const [betAmount, setBetAmount] = useState("0.1");
  const [loading, setLoading] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  const [seedCopied, setSeedCopied] = useState(false);

  // Fixed to CoinFlip only
  const selectedGameType: "CoinFlip" = "CoinFlip";

  const handleCreateBattle = async () => {
    if (!connected || !publicKey) {
      Alert.alert("Error", "Please connect your wallet first");
      return;
    }

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert("Error", "Please enter a valid bet amount");
      return;
    }

    if (amount > balance) {
      Alert.alert("Error", "Insufficient balance");
      return;
    }

    // 1. 生成种子
    try {
      const seedArray = new Uint8Array(32);
      crypto.getRandomValues(seedArray);
      const seedHex = Array.from(seedArray)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      console.log("Generated seed:", seedHex);

      setPendingSeed(seedHex);
      setSeedCopied(false);
      setShowSeedModal(true);
    } catch (error) {
      console.error("Failed to generate seed:", error);
      Alert.alert("Error", "Failed to generate seed");
    }
  };

  const copySeedToClipboard = async () => {
    if (pendingSeed) {
      await Clipboard.setStringAsync(pendingSeed);
      setSeedCopied(true);
      Alert.alert("Success", "Seed copied to clipboard!");
    }
  };

  const confirmCreateBattle = async () => {
    if (!seedCopied) {
      Alert.alert("Warning", "Please copy and save your seed first!");
      return;
    }

    if (!pendingSeed) {
      return;
    }

    setShowSeedModal(false);
    setLoading(true);

    try {
      // 将 hex 转换为 Uint8Array
      const seed = new Uint8Array(
        pendingSeed.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16)),
      );

      const result = await createBattle(
        parseFloat(betAmount),
        selectedGameType,
        seed,
      );

      Alert.alert(
        "Success",
        `Battle created successfully!\n\nIMPORTANT: Save your seed securely!\n\nSeed: ${pendingSeed}\n\nSignature: ${result.signature.slice(0, 8)}...${result.signature.slice(-8)}`,
        [
          {
            text: "View Battle",
            onPress: () => router.push(`/battle/${result.battlePda}`),
          },
          {
            text: "Go to Lobby",
            onPress: () => router.back(),
          },
        ],
      );
    } catch (error: any) {
      console.error("Failed to create battle:", error);

      if (
        error?.message?.includes("Cancellation") ||
        error?.message?.includes("cancelled")
      ) {
        Alert.alert("Cancelled", "Transaction was cancelled");
      } else if (error?.message) {
        Alert.alert("Error", `Failed to create battle: ${error.message}`);
      } else {
        Alert.alert("Error", "Failed to create battle: Unknown error");
      }
    } finally {
      setLoading(false);
      setPendingSeed(null);
    }
  };

  const formatBalance = () => {
    return balance.toFixed(2);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      {/* <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Battle</Text>
        <View style={styles.placeholder} />
      </View> */}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Balance Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Your Balance</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.balanceAmount}>{formatBalance()} SOL</Text>
            <Text style={styles.balanceLabel}>Available to wager</Text>
          </View>
        </View>

        {/* Bet Amount */}
        <View style={styles.card}>
          <Text style={styles.label}>Bet Amount (SOL)</Text>
          <TextInput
            style={styles.input}
            value={betAmount}
            onChangeText={setBetAmount}
            keyboardType="decimal-pad"
            placeholder="0.1"
            placeholderTextColor="#9db4b9"
          />
          <View style={styles.suggestions}>
            {["0.01", "0.1", "0.5", "1"].map((amount) => (
              <TouchableOpacity
                key={amount}
                style={styles.suggestionButton}
                onPress={() => setBetAmount(amount)}
              >
                <Text style={styles.suggestionText}>{amount} SOL</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Create Button */}
        <TouchableOpacity
          style={styles.createButton}
          onPress={handleCreateBattle}
          disabled={loading || !connected}
        >
          {loading ? (
            <ActivityIndicator color="#0d1117" />
          ) : (
            <Text style={styles.createButtonText}>
              {connected ? "Create Battle" : "Connect Wallet First"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>ℹ️ How it works</Text>
          <Text style={styles.infoText}>
            1. Create a battle by choosing a game type and bet amount
          </Text>
          <Text style={styles.infoText}>
            2. Your seed is committed and hidden until reveal
          </Text>
          <Text style={styles.infoText}>
            3. Another player can join your battle
          </Text>
          <Text style={styles.infoText}>
            4. Both players reveal their seeds to determine the winner
          </Text>
        </View>
      </ScrollView>

      {/* Seed Modal */}
      <Modal
        visible={showSeedModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (seedCopied) {
            setShowSeedModal(false);
            setPendingSeed(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalIconContainer}>
                <Text style={styles.modalIcon}>🔑</Text>
              </View>
              <View style={styles.modalHeaderContent}>
                <Text style={styles.modalTitle}>Save Your Seed!</Text>
                <Text style={styles.modalSubtitle}>
                  This is required to reveal your battle later
                </Text>
              </View>
            </View>

            {/* Seed Display */}
            <View style={styles.seedContainer}>
              <Text style={styles.seedLabel}>
                Your Secret Seed (64 hex characters)
              </Text>
              <View style={styles.seedDisplay}>
                <Text style={styles.seedText}>{pendingSeed}</Text>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={copySeedToClipboard}
                >
                  <Text style={styles.copyButtonText}>
                    {seedCopied ? "✓" : "📋"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Warning */}
            <View style={styles.warningBox}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <View style={styles.warningContent}>
                <Text style={styles.warningTitle}>Important!</Text>
                <Text style={styles.warningText}>
                  Save this seed securely in a password manager or safe place.{" "}
                  <Text style={styles.warningBold}>
                    We cannot recover lost seeds.
                  </Text>
                </Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowSeedModal(false);
                  setPendingSeed(null);
                  setSeedCopied(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  !seedCopied && styles.confirmButtonDisabled,
                ]}
                onPress={confirmCreateBattle}
                disabled={!seedCopied}
              >
                <Text
                  style={[
                    styles.confirmButtonText,
                    !seedCopied && styles.confirmButtonTextDisabled,
                  ]}
                >
                  {seedCopied ? "I've Saved It" : "Copy First"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#283639",
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonText: {
    color: "#13C8F4",
    fontSize: 24,
    fontWeight: "bold",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: "#1c2527",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    color: "#9db4b9",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  cardBody: {
    alignItems: "center",
    paddingVertical: 8,
  },
  balanceAmount: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
  },
  balanceLabel: {
    color: "#9db4b9",
    fontSize: 12,
    marginTop: 4,
  },
  label: {
    color: "#9db4b9",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#283639",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  suggestions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  suggestionButton: {
    backgroundColor: "#283639",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  suggestionText: {
    color: "#13C8F4",
    fontSize: 12,
    fontWeight: "600",
  },
  createButton: {
    backgroundColor: "#13C8F4",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  createButtonText: {
    color: "#0d1117",
    fontSize: 16,
    fontWeight: "bold",
  },
  infoCard: {
    backgroundColor: "rgba(20, 241, 149, 0.05)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(20, 241, 149, 0.1)",
  },
  infoTitle: {
    color: "#14F195",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
  },
  infoText: {
    color: "#9db4b9",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#1c2527",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    borderWidth: 2,
    borderColor: "#13C8F4",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  modalIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(250, 204, 21, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalIcon: {
    fontSize: 24,
  },
  modalHeaderContent: {
    flex: 1,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalSubtitle: {
    color: "#9db4b9",
    fontSize: 14,
  },
  seedContainer: {
    marginBottom: 16,
  },
  seedLabel: {
    color: "#9db4b9",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  seedDisplay: {
    backgroundColor: "#283639",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    padding: 16,
    position: "relative",
  },
  seedText: {
    color: "#13C8F4",
    fontSize: 14,
    fontFamily: "monospace",
    paddingRight: 40,
  },
  copyButton: {
    position: "absolute",
    right: 12,
    top: 12,
    backgroundColor: "rgba(19, 200, 244, 0.1)",
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  copyButtonText: {
    fontSize: 16,
  },
  warningBox: {
    backgroundColor: "rgba(255, 68, 68, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 68, 68, 0.3)",
    padding: 12,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  warningIcon: {
    fontSize: 16,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    color: "#ff6b6b",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  warningText: {
    color: "#9db4b9",
    fontSize: 12,
    lineHeight: 18,
  },
  warningBold: {
    color: "#ff6b6b",
    fontWeight: "bold",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#283639",
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButton: {
    backgroundColor: "#13C8F4",
  },
  confirmButtonDisabled: {
    backgroundColor: "#283639",
    opacity: 0.5,
  },
  confirmButtonText: {
    color: "#0d1117",
    fontSize: 16,
    fontWeight: "bold",
  },
  confirmButtonTextDisabled: {
    color: "#9db4b9",
  },
});
