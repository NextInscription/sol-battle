import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useWallet } from '@/contexts/WalletContext';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

export function WalletConnect() {
  const { publicKey, connected, balance, connect, disconnect, sendSol, loading } = useWallet();
  const [sendModalVisible, setSendModalVisible] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');

  const handleConnect = async () => {
    try {
      await connect();
      Alert.alert('成功', '钱包已连接');
    } catch (error) {
      Alert.alert('连接失败', '请确保已安装支持 Solana Mobile Wallet Adapter 的钱包应用');
    }
  };

  const handleSend = async () => {
    if (!recipientAddress || !amount) {
      Alert.alert('错误', '请填写收款地址和金额');
      return;
    }

    try {
      const signature = await sendSol(recipientAddress, parseFloat(amount));
      setSendModalVisible(false);
      setRecipientAddress('');
      setAmount('');
      Alert.alert('成功', `交易已发送\n签名: ${signature}`);
    } catch (error) {
      Alert.alert('发送失败', '请检查地址和余额');
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  if (!connected) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.infoText}>
          点击下方按钮连接您的 Solana 钱包
        </ThemedText>
        <TouchableOpacity
          style={styles.connectButton}
          onPress={handleConnect}
          disabled={loading}>
          <ThemedText style={styles.connectButtonText}>
            {loading ? '连接中...' : '连接钱包'}
          </ThemedText>
        </TouchableOpacity>
        <ThemedText style={styles.hintText}>
          需要安装支持 Mobile Wallet Adapter 的钱包应用（如 Phantom、Solflare 等）
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.walletInfo}>
        <View>
          <ThemedText style={styles.label}>钱包地址</ThemedText>
          <ThemedText style={styles.address}>
            {publicKey ? formatAddress(publicKey.toBase58()) : ''}
          </ThemedText>
        </View>
        <View style={styles.balanceContainer}>
          <ThemedText style={styles.label}>余额</ThemedText>
          <ThemedText style={styles.balance}>{balance.toFixed(4)} SOL</ThemedText>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.sendButton]}
          onPress={() => setSendModalVisible(true)}
          disabled={loading}>
          <ThemedText style={styles.actionButtonText}>发送 SOL</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.disconnectButton]}
          onPress={disconnect}
          disabled={loading}>
          <ThemedText style={styles.actionButtonText}>
            {loading ? '断开中...' : '断开连接'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={sendModalVisible}
        onRequestClose={() => setSendModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="title" style={styles.modalTitle}>
              发送 SOL
            </ThemedText>

            <ThemedText style={styles.inputLabel}>收款地址</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="输入收款地址"
              placeholderTextColor="#999"
              value={recipientAddress}
              onChangeText={setRecipientAddress}
              autoCapitalize="none"
            />

            <ThemedText style={styles.inputLabel}>金额（SOL）</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="输入金额"
              placeholderTextColor="#999"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />

            <ThemedText style={styles.balanceHint}>
              当前余额: {balance.toFixed(4)} SOL
            </ThemedText>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleSend}
              disabled={loading}>
              <ThemedText style={styles.actionButtonText}>
                {loading ? '发送中...' : '确认发送'}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setSendModalVisible(false)}>
              <ThemedText style={styles.cancelButtonText}>取消</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </KeyboardAvoidingView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  infoText: {
    textAlign: 'center',
    marginBottom: 8,
  },
  connectButton: {
    backgroundColor: '#9945FF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 8,
  },
  walletInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
    opacity: 0.7,
  },
  address: {
    fontSize: 16,
    fontWeight: '600',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balance: {
    fontSize: 24,
    fontWeight: '700',
    color: '#14F195',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  sendButton: {
    flex: 1,
    backgroundColor: '#14F195',
  },
  disconnectButton: {
    flex: 1,
    backgroundColor: '#FF4444',
  },
  actionButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(120, 120, 120, 0.2)',
  },
  cancelButtonText: {
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    padding: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    color: '#fff',
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '600',
  },
  balanceHint: {
    fontSize: 12,
    marginBottom: 20,
    textAlign: 'center',
    opacity: 0.7,
  },
});
