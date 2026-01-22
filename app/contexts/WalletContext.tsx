import { PROGRAM_ID } from "@/config/network";
import { textToUint8Array } from "@/utils/battles";
import { saveSeed } from "@/utils/seedStorage";
import {
  transact,
  Web3MobileWallet,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { keccak256 } from "js-sha3";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const PROGRAM_ID_PUBKEY = new PublicKey(PROGRAM_ID);

interface WalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  balance: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendSol: (toAddress: string, amount: number) => Promise<string>;
  getBalance: () => Promise<void>;
  loading: boolean;
  authToken: string | null;
  initializeConfig: () => Promise<string>;
  joinBattle: (
    battlePda: string,
    betAmountSol: number,
  ) => Promise<{ signature: string; seed: Uint8Array }>;
  createBattle: (
    betAmountSol: number,
    gameType: "CoinFlip",
    seed?: Uint8Array,
  ) => Promise<{ signature: string; battlePda: string; seed: Uint8Array }>;
  revealSeed: (battlePda: string, seed: Uint8Array) => Promise<string>;
  claimRefund: (battlePda: string) => Promise<string>;
  claimTimeoutWin: (battlePda: string) => Promise<string>;
  isWalletConnected: () => boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);
const toByteArray = (base64String: string) => {
  const binaryString = atob(base64String);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }
  return byteArray;
};
// App 身份配置 - 替换为你的实际应用信息
const APP_IDENTITY = {
  name: "Battle Arena",
  uri: "http://battle.ekkoye.xyz/",
  icon: "/favicon.ico",
};

const TESTNET_RPC_URL = "https://api.testnet.solana.com";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const connected = !!publicKey;

  const connect = useCallback(async () => {
    setLoading(true);
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => {
        // 使用新的 MWA 2.0 API 签名
        const authResult = await wallet.authorize({
          identity: APP_IDENTITY,
          chain: "solana:testnet",
        });

        return authResult;
      });

      if (!result) {
        throw new Error("No authorization result");
      }

      console.log("Auth result:", result);

      // 保存授权信息
      setAuthToken(result.auth_token);

      // 检查账户数据
      if (!result.accounts || result.accounts.length === 0) {
        throw new Error("No accounts found");
      }

      const account = result.accounts[0];
      console.log("Full account object:", JSON.stringify(account, null, 2));
      console.log("Account address:", account.address);

      // MWA 返回的 address 是 base64 编码的，需要解码
      let pubKey: PublicKey;
      try {
        // 将 base64 地址解码为 Uint8Array
        const binaryString = atob(account.address);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        console.log("Decoded bytes:", bytes);

        // 从字节数组创建 PublicKey
        pubKey = new PublicKey(bytes);
        console.log("Public key created:", pubKey.toBase58());
      } catch (e) {
        console.error("Failed to decode address:", e);
        throw new Error(`Failed to decode wallet address: ${e}`);
      }

      setPublicKey(pubKey);
      console.log("Public key set:", pubKey.toBase58());

      // 获取余额
      const connection = new Connection(TESTNET_RPC_URL);
      const balance = await connection.getBalance(pubKey);
      setBalance(balance / 1e9);
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const disconnect = useCallback(async () => {
    // 断开连接只需要清理本地状态，不需要调用钱包
    setPublicKey(null);
    setBalance(0);
    setAuthToken(null);
  }, []);

  const getBalance = useCallback(async () => {
    if (!publicKey) return;

    setLoading(true);
    try {
      const connection = new Connection(TESTNET_RPC_URL);
      const balance = await connection.getBalance(publicKey);
      setBalance(balance / 1e9);
    } catch (error) {
      console.error("Failed to get balance:", error);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  const sendSol = useCallback(
    async (toAddress: string, amount: number) => {
      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);
        const toPublicKey = new PublicKey(toAddress);
        const latestBlockhash = await connection.getLatestBlockhash();

        // 构建交易指令
        const instructions = [
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: toPublicKey,
            lamports: amount * 1e9,
          }),
        ];

        // 构建版本化交易
        const transactionMessage = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(transactionMessage);

        // 使用钱包签名并发送交易
        const signatures = await transact(async (wallet: Web3MobileWallet) => {
          // 直接签名交易,不调用 authorize()
          const txSignatures = await wallet.signAndSendTransactions({
            transactions: [transaction],
          });

          return txSignatures;
        });

        // 等待交易确认
        const confirmationResult = await connection.confirmTransaction(
          signatures[0],
          "confirmed",
        );

        if (confirmationResult.value.err) {
          throw new Error(JSON.stringify(confirmationResult.value.err));
        }

        // 更新余额
        await getBalance();

        return signatures[0];
      } catch (error) {
        console.error("Failed to send SOL:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, getBalance],
  );

  // Helper functions for join battle
  const generateRandomSeed = useCallback((): Uint8Array => {
    const seed = new Uint8Array(32);
    const randomValues = new Array(32);
    for (let i = 0; i < 32; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
    for (let i = 0; i < 32; i++) {
      seed[i] = randomValues[i];
    }
    return seed;
  }, []);

  const getJoinBattleDiscriminator = useCallback((): Uint8Array => {
    return new Uint8Array([126, 0, 69, 130, 127, 145, 54, 100]);
  }, []);

  const getCreateBattleDiscriminator = useCallback((): Uint8Array => {
    // create_battle instruction discriminator
    return new Uint8Array([2, 249, 54, 216, 42, 99, 187, 102]);
  }, []);

  const getRevealSeedDiscriminator = useCallback((): Uint8Array => {
    // reveal_seed instruction discriminator
    return new Uint8Array([196, 119, 194, 112, 156, 211, 239, 105]);
  }, []);

  const getSettleBattleDiscriminator = useCallback((): Uint8Array => {
    // settle_battle instruction discriminator
    return new Uint8Array([4, 146, 32, 157, 82, 216, 214, 28]);
  }, []);

  const getInitializeConfigDiscriminator = useCallback((): Uint8Array => {
    // initialize_config instruction discriminator
    return new Uint8Array([208, 127, 21, 1, 194, 190, 196, 70]);
  }, []);

  const initializeConfig = useCallback(async () => {
    if (!publicKey) {
      throw new Error("Wallet not connected");
    }

    setLoading(true);
    try {
      const connection = new Connection(TESTNET_RPC_URL);

      // 获取 config PDA
      const [configPda] = PublicKey.findProgramAddressSync(
        [textToUint8Array("config")],
        PROGRAM_ID_PUBKEY,
      );

      // 构建 initialize_config 指令数据
      // discriminator(8) + fee_bps(2) + reveal_timeout_slots(8) + no_challenger_timeout_slots(8)
      const data = new Uint8Array(8 + 2 + 8 + 8);

      let offset = 0;

      // discriminator (8 bytes)
      const discriminator = getInitializeConfigDiscriminator();
      data.set(discriminator, offset);
      offset += 8;

      // fee_bps (u16, 2 bytes) - 100 = 1%
      const feeBpsView = new DataView(new ArrayBuffer(2));
      feeBpsView.setUint16(0, 100, true); // 1% fee
      for (let i = 0; i < 2; i++) {
        data[offset + i] = new Uint8Array(feeBpsView.buffer)[i];
      }
      offset += 2;

      // reveal_timeout_slots (u64, 8 bytes) - 100 slots
      const revealTimeoutView = new DataView(new ArrayBuffer(8));
      revealTimeoutView.setBigUint64(0, BigInt(100), true);
      for (let i = 0; i < 8; i++) {
        data[offset + i] = new Uint8Array(revealTimeoutView.buffer)[i];
      }
      offset += 8;

      // no_challenger_timeout_slots (u64, 8 bytes) - 500 slots
      const noChallengerTimeoutView = new DataView(new ArrayBuffer(8));
      noChallengerTimeoutView.setBigUint64(0, BigInt(500), true);
      for (let i = 0; i < 8; i++) {
        data[offset + i] = new Uint8Array(noChallengerTimeoutView.buffer)[i];
      }

      console.log("Initializing config with PDA:", configPda.toBase58());

      // 获取最新 blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // 构建指令
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID_PUBKEY,
        data: Buffer.from(data),
      });

      // 构建 VersionedTransaction
      const transactionMessage = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [instruction],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(transactionMessage);

      // 使用 transact 签名并发送交易
      const signature = await transact(async (wallet: Web3MobileWallet) => {
        try {
          // 每次都重新授权以获取新的 auth_token
          const authorizeParams: any = {
            identity: APP_IDENTITY,
            cluster: "solana:testnet",
          };

          const authorizationResult = await wallet.authorize(authorizeParams);
          console.log("Authorization successful");

          if (authorizationResult.auth_token) {
            setAuthToken(authorizationResult.auth_token);
            console.log("Auth token updated");
          }

          // 签名交易
          const signedTransactions = await wallet.signTransactions({
            transactions: [transaction],
          });

          // 发送交易
          const txSignature = await connection.sendRawTransaction(
            signedTransactions[0].serialize(),
          );

          // 等待确认
          const confirmation = await connection.confirmTransaction(txSignature);
          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          return txSignature;
        } catch (error: any) {
          console.error("Error in transact:", error);

          // 如果是授权错误，清除失效的 token
          if (error?.message?.includes('auth_token') || error?.message?.includes('authorization')) {
            console.log("Clearing invalid auth token");
            setAuthToken(null);
          }

          throw error;
        }
      });

      console.log("Config initialized successfully:", signature);
      return signature;
    } catch (error) {
      console.error("Failed to initialize config:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [publicKey, authToken, getInitializeConfigDiscriminator]);

  const joinBattle = useCallback(
    async (battlePda: string, betAmountSol: number) => {
      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);

        // 检查 config 是否已初始化
        const [configPda] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );
        const configAccountInfo = await connection.getAccountInfo(configPda);

        if (!configAccountInfo) {
          console.log("Config not initialized, initializing...");
          await initializeConfig();
          console.log("Config initialized successfully");
        }

        // 1. 生成种子
        const seed = generateRandomSeed();

        // 2. 计算承诺哈希
        const seedHash = keccak256(seed);
        const commitHash = new Uint8Array(
          seedHash.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16)),
        );

        // 4. 转换押注金额为 lamports
        const betAmountLamports = Math.floor(betAmountSol * 1e9);

        // 5. 构建 join_battle 指令数据
        const data = new Uint8Array(8 + 8 + 32 + 32);

        // discriminator (8 bytes)
        const discriminator = getJoinBattleDiscriminator();
        data.set(discriminator, 0);

        // bet_amount (u64 LE, 8 bytes)
        const view = new DataView(new ArrayBuffer(8));
        view.setBigUint64(0, BigInt(betAmountLamports), true);
        for (let i = 0; i < 8; i++) {
          data[8 + i] = new Uint8Array(view.buffer)[i];
        }

        // commit_hash (32 bytes)
        data.set(commitHash, 16);

        // seed (32 bytes)
        data.set(seed, 48);
        console.log("Instruction data:", data);
        console.log("Config PDA:", configPda.toBase58());
        console.log("Battle PDA:", battlePda);
        console.log("User PublicKey:", publicKey.toBase58());

        // 6. 获取最新 blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        console.log("Blockhash:", blockhash);

        // 7. 构建指令
        const instruction = new TransactionInstruction({
          keys: [
            { pubkey: configPda, isSigner: false, isWritable: true },
            {
              pubkey: new PublicKey(battlePda),
              isSigner: false,
              isWritable: true,
            },
            { pubkey: publicKey, isSigner: true, isWritable: true },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
          programId: PROGRAM_ID_PUBKEY,
          data: Buffer.from(data),
        });

        // 8. 构建交易
        const transaction = new Transaction();
        transaction.add(instruction);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        console.log("Transaction created:", transaction);

        // 9. 使用 transact 签名并发送交易
        const result = await transact(async (wallet: Web3MobileWallet) => {
          try {
            // 尝试使用已有的 auth_token 进行授权
            const authorizeParams: any = {
              identity: APP_IDENTITY,
              cluster: "solana:testnet",
            };

            // 如果有有效的 auth_token，尝试使用它
            if (authToken) {
              authorizeParams.auth_token = authToken;
              console.log("Using existing auth_token");
            }

            const authorizationResult = await wallet.authorize(authorizeParams);
            console.log("Authorization successful");

            if (authorizationResult.auth_token) {
              setAuthToken(authorizationResult.auth_token);
              console.log("Auth token updated");
            }

            // 签名交易
            console.log("Calling signTransactions...");
            const signedTransactions = await wallet.signTransactions({
              transactions: [transaction],
            });
            console.log("Transaction signed successfully, received:", signedTransactions.length, "transactions");

            // 发送交易
            console.log("Sending raw transaction...");
            const signature = await connection.sendRawTransaction(
              signedTransactions[0].serialize(),
            );
            console.log("Transaction sent with signature:", signature);

            // 等待交易确认
            const confirmation = await connection.confirmTransaction(signature);
            console.log("Transaction confirmation:", confirmation);

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return { signature, seed };
          } catch (error: any) {
            console.error("Error in transact:", error);
            throw error;
          }
        });

        // Save seed for later reveal
        await saveSeed(battlePda, result.seed);

        return result;
      } catch (error) {
        console.error("Failed to join battle:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, generateRandomSeed, getJoinBattleDiscriminator, initializeConfig],
  );

  const createBattle = useCallback(
    async (betAmountSol: number, gameType: "CoinFlip", seed?: Uint8Array) => {
      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      console.log("Creating battle with bet:", betAmountSol, "game:", gameType);
      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);

        // 检查 config 是否已初始化
        const [configPdaCheck] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );
        const configAccountInfo = await connection.getAccountInfo(configPdaCheck);

        if (!configAccountInfo) {
          console.log("Config not initialized, initializing...");
          await initializeConfig();
          console.log("Config initialized successfully");
        }

        // 1. 使用预生成的种子或生成新种子
        const finalSeed = seed || generateRandomSeed();

        // 2. 计算承诺哈希
        const seedHash = keccak256(finalSeed);
        const commitHash = new Uint8Array(
          seedHash.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16)),
        );

        // 3. 获取 config 账户
        const [configPda] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );

        // 4. 读取 config 获取 battle_count
        const configAccountInfoForCount = await connection.getAccountInfo(configPda);
        if (!configAccountInfoForCount) {
          throw new Error("Config account not found. Please initialize the program first.");
        }

        const configData = configAccountInfoForCount.data;
        // Config 结构: discriminator(8) + authority(32) + fee_bps(2) + reveal_timeout(8) + no_challenger_timeout(8) + battle_count(8)
        const battleCountOffset = 8 + 32 + 2 + 8 + 8; // = 58
        const battleCountData = configData.subarray(battleCountOffset, battleCountOffset + 8);
        const battleCountBytes = Array.from(battleCountData);

        // 5. 转换押注金额为 lamports
        const betAmountLamports = Math.floor(betAmountSol * 1e9);

        // 6. 构建 create_battle 指令数据
        // discriminator(8) + bet_amount(8) + commit_hash(32) + game_type(1)
        const data = new Uint8Array(8 + 8 + 32 + 1);

        let offset = 0;

        // discriminator (8 bytes)
        const discriminator = getCreateBattleDiscriminator();
        data.set(discriminator, offset);
        offset += 8;

        // bet_amount (u64 LE, 8 bytes)
        const view = new DataView(new ArrayBuffer(8));
        view.setBigUint64(0, BigInt(betAmountLamports), true);
        for (let i = 0; i < 8; i++) {
          data[offset + i] = new Uint8Array(view.buffer)[i];
        }
        offset += 8;

        // commit_hash (32 bytes)
        data.set(commitHash, offset);
        offset += 32;

        // game_type (u8, 1 byte) - 0 for CoinFlip, 1 for DiceRoll
        data[offset] = gameType === "CoinFlip" ? 0 : 1;

        // 7. 使用全局 publicKey 生成 Battle PDA（不需要重新授权）
        const [battlePda] = PublicKey.findProgramAddressSync(
          [
            textToUint8Array("battle"),
            publicKey.toBuffer(),
            new Uint8Array(battleCountBytes),
          ],
          PROGRAM_ID_PUBKEY,
        );
        console.log("Battle PDA:", battlePda.toBase58());

        // 8. 使用 transact 签名并发送交易
        const result = await transact(async (wallet: Web3MobileWallet) => {
          try {
            // 尝试使用已有的 auth_token 进行授权
            const authorizeParams: any = {
              identity: APP_IDENTITY,
              cluster: "solana:testnet",
            };

            // 如果有有效的 auth_token，尝试使用它
            if (authToken) {
              authorizeParams.auth_token = authToken;
              console.log("Using existing auth_token");
            }

            const authorizationResult = await wallet.authorize(authorizeParams);
            console.log("Authorization successful");

            if (authorizationResult.auth_token) {
              setAuthToken(authorizationResult.auth_token);
              console.log("Auth token updated");
            }

            // Step 1: 获取最新 blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            console.log("blockhash", blockhash);

            // Step 2: 构建指令
            const instruction = new TransactionInstruction({
              keys: [
                { pubkey: configPda, isSigner: false, isWritable: true },
                { pubkey: battlePda, isSigner: false, isWritable: true },
                { pubkey: publicKey, isSigner: true, isWritable: true },
                {
                  pubkey: SystemProgram.programId,
                  isSigner: false,
                  isWritable: false,
                },
              ],
              programId: PROGRAM_ID_PUBKEY,
              data: Buffer.from(data),
            });

            // Step 3: 构建交易
            const transaction = new Transaction();
            transaction.add(instruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Step 4: 签名并发送交易
            console.log("Calling signTransactions...");
            const signedTransactions = await wallet.signTransactions({
              transactions: [transaction],
            });
            console.log("Transaction signed successfully");

            // 发送交易
            const signature = await connection.sendRawTransaction(
              signedTransactions[0].serialize(),
            );
            console.log("Transaction sent with signature:", signature);

            // 等待交易确认
            const confirmation = await connection.confirmTransaction(signature);
            console.log("Transaction confirmation:", confirmation);

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return {
              signature,
              battlePda: battlePda.toBase58(),
              seed: finalSeed,
            };
          } catch (error: any) {
            console.error("Error in transact:", error);

            // 如果是授权错误，清除失效的 token
            if (error?.message?.includes('auth_token') || error?.message?.includes('authorization')) {
              console.log("Clearing invalid auth token");
              setAuthToken(null);
            }

            throw error;
          }
        });

        // Save seed for later reveal
        await saveSeed(result.battlePda, result.seed);

        return result;
      } catch (error) {
        console.error("Failed to create battle:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [authToken, generateRandomSeed, getCreateBattleDiscriminator, initializeConfig],
  );

  const revealSeed = useCallback(
    async (battlePda: string, seed: Uint8Array) => {
      console.log("Revealing seed for battle:", battlePda);

      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);

        // 1. 获取 config 账户
        const [configPda] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );

        // 2. 构建 reveal_seed 指令数据
        // discriminator(8) + seed(32)
        const data = new Uint8Array(8 + 32);

        // discriminator (8 bytes)
        const discriminator = getRevealSeedDiscriminator();
        data.set(discriminator, 0);

        // seed (32 bytes)
        data.set(seed, 8);

        // 3. 读取 battle 数据获取 creator 和 challenger
        const battlePubkey = new PublicKey(battlePda);
        const battleAccountInfo = await connection.getAccountInfo(battlePubkey);
        if (!battleAccountInfo) {
          throw new Error('Battle not found');
        }

        const battleData = battleAccountInfo.data as Buffer;
        let battleOffset = 8; // Skip discriminator

        // Skip battle_id (8 bytes)
        battleOffset += 8;

        // Read creator (32 bytes)
        const creator = new PublicKey(battleData.subarray(battleOffset, battleOffset + 32));
        battleOffset += 32;

        // Read challenger tag and challenger
        const challengerTag = battleData.readUInt8(battleOffset);
        battleOffset += 1;
        let challenger = null;
        if (challengerTag !== 0) {
          challenger = new PublicKey(battleData.subarray(battleOffset, battleOffset + 32));
        }

        if (!challenger) {
          throw new Error('Challenger not found');
        }

        // 4. 使用 transact 签名并发送交易（包含 reveal + settle 两个指令）
        const signature = await transact(async (wallet: Web3MobileWallet) => {
          try {
            // 尝试使用已有的 auth_token 进行授权
            const authorizeParams: any = {
              identity: APP_IDENTITY,
              cluster: "solana:testnet",
            };

            // 如果有有效的 auth_token，尝试使用它
            if (authToken) {
              authorizeParams.auth_token = authToken;
              console.log("Using existing auth_token");
            }

            const authorizationResult = await wallet.authorize(authorizeParams);
            console.log("Authorization successful");

            if (authorizationResult.auth_token) {
              setAuthToken(authorizationResult.auth_token);
              console.log("Auth token updated");
            }

            // Step 1: 获取最新 blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            console.log("blockhash", blockhash);

            // Step 2: 构建 reveal_seed 指令
            const revealInstruction = new TransactionInstruction({
              keys: [
                { pubkey: configPda, isSigner: false, isWritable: false },
                {
                  pubkey: battlePubkey,
                  isSigner: false,
                  isWritable: true,
                },
                { pubkey: publicKey, isSigner: true, isWritable: false },
              ],
              programId: PROGRAM_ID_PUBKEY,
              data: Buffer.from(data),
            });

            // Step 3: 构建 settle_battle 指令
            // settle_battle discriminator (8 bytes) + 无参数
            const settleData = new Uint8Array(8);
            const settleDiscriminator = getSettleBattleDiscriminator();
            settleData.set(settleDiscriminator, 0);

            const settleInstruction = new TransactionInstruction({
              keys: [
                { pubkey: configPda, isSigner: false, isWritable: false },
                { pubkey: battlePubkey, isSigner: false, isWritable: true },
                { pubkey: creator, isSigner: false, isWritable: true },
                { pubkey: challenger, isSigner: false, isWritable: true },
                { pubkey: configPda, isSigner: false, isWritable: true }, // fee_recipient
                { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System Program
              ],
              programId: PROGRAM_ID_PUBKEY,
              data: Buffer.from(settleData),
            });

            // Step 4: 构建交易（包含两个指令）
            const transaction = new Transaction();
            transaction.add(revealInstruction);
            transaction.add(settleInstruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Step 5: 签名并发送交易
            console.log("Calling signTransactions with reveal + settle...");
            const signedTransactions = await wallet.signTransactions({
              transactions: [transaction],
            });
            console.log("Transaction signed successfully");

            // 发送交易
            const txSignature = await connection.sendRawTransaction(
              signedTransactions[0].serialize(),
            );
            console.log("Transaction sent with signature:", txSignature);

            // 等待交易确认
            const confirmation = await connection.confirmTransaction(txSignature);
            console.log("Transaction confirmation:", confirmation);

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return txSignature;
          } catch (error: any) {
            console.error("Error in transact:", error);
            throw error;
          }
        });

        return signature;
      } catch (error) {
        console.error("Failed to reveal seed:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [authToken, getRevealSeedDiscriminator, getSettleBattleDiscriminator],
  );

  // Claim Refund - 退款（没人加入时）
  const claimRefund = useCallback(
    async (battlePda: string) => {
      console.log("Claiming refund for battle:", battlePda);

      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);

        // 1. 获取 PDA
        const [configPda] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );

        const battlePubkey = new PublicKey(battlePda);

        // 2. 构建 claim_refund_no_challenger 指令
        // discriminator: [72, 82, 83, 129, 67, 12, 17, 26]
        const refundDiscriminator = new Uint8Array([72, 82, 83, 129, 67, 12, 17, 26]);

        const data = new Uint8Array(8);
        data.set(refundDiscriminator, 0);

        // 3. 使用 transact 签名并发送交易
        const signature = await transact(async (wallet: Web3MobileWallet) => {
          try {
            const authorizeParams: any = {
              identity: APP_IDENTITY,
              cluster: "solana:testnet",
            };

            if (authToken) {
              authorizeParams.auth_token = authToken;
              console.log("Using existing auth_token");
            }

            const authorizationResult = await wallet.authorize(authorizeParams);
            console.log("Authorization successful");

            if (authorizationResult.auth_token) {
              setAuthToken(authorizationResult.auth_token);
              console.log("Auth token updated");
            }

            const { blockhash } = await connection.getLatestBlockhash();
            console.log("blockhash", blockhash);

            const instruction = new TransactionInstruction({
              keys: [
                { pubkey: configPda, isSigner: false, isWritable: true },
                { pubkey: battlePubkey, isSigner: false, isWritable: true },
                { pubkey: publicKey, isSigner: true, isWritable: true },
                { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
              ],
              programId: PROGRAM_ID_PUBKEY,
              data: Buffer.from(data),
            });

            const transaction = new Transaction();
            transaction.add(instruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            console.log("Calling signTransactions for claim refund...");
            const signedTransactions = await wallet.signTransactions({
              transactions: [transaction],
            });
            console.log("Transaction signed successfully");

            const txSignature = await connection.sendRawTransaction(
              signedTransactions[0].serialize(),
            );
            console.log("Transaction sent with signature:", txSignature);

            const confirmation = await connection.confirmTransaction(txSignature);
            console.log("Transaction confirmation:", confirmation);

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return txSignature;
          } catch (error: any) {
            console.error("Error in transact:", error);
            throw error;
          }
        });

        return signature;
      } catch (error) {
        console.error("Failed to claim refund:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  // Claim Timeout Win - 超时获胜（创建者不揭示时）
  const claimTimeoutWin = useCallback(
    async (battlePda: string) => {
      console.log("Claiming timeout win for battle:", battlePda);

      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      try {
        const connection = new Connection(TESTNET_RPC_URL);

        // 1. 获取 PDA 和 fee_recipient
        const [configPda] = PublicKey.findProgramAddressSync(
          [textToUint8Array("config")],
          PROGRAM_ID_PUBKEY,
        );

        const battlePubkey = new PublicKey(battlePda);

        // 获取 fee_recipient (config authority)
        const configAccountInfo = await connection.getAccountInfo(configPda);
        if (!configAccountInfo) {
          throw new Error('Config account not found');
        }
        const feeRecipient = new PublicKey(configAccountInfo.data.subarray(8, 40));

        // 2. 构建 claim_creator_timeout_win 指令
        // discriminator: [58, 123, 123, 193, 154, 220, 27, 146]
        const timeoutWinDiscriminator = new Uint8Array([58, 123, 123, 193, 154, 220, 27, 146]);

        const data = new Uint8Array(8);
        data.set(timeoutWinDiscriminator, 0);

        // 3. 使用 transact 签名并发送交易
        const signature = await transact(async (wallet: Web3MobileWallet) => {
          try {
            const authorizeParams: any = {
              identity: APP_IDENTITY,
              cluster: "solana:testnet",
            };

            if (authToken) {
              authorizeParams.auth_token = authToken;
              console.log("Using existing auth_token");
            }

            const authorizationResult = await wallet.authorize(authorizeParams);
            console.log("Authorization successful");

            if (authorizationResult.auth_token) {
              setAuthToken(authorizationResult.auth_token);
              console.log("Auth token updated");
            }

            const { blockhash } = await connection.getLatestBlockhash();
            console.log("blockhash", blockhash);

            const instruction = new TransactionInstruction({
              keys: [
                { pubkey: configPda, isSigner: false, isWritable: true },
                { pubkey: battlePubkey, isSigner: false, isWritable: true },
                { pubkey: publicKey, isSigner: true, isWritable: true },
                { pubkey: feeRecipient, isSigner: false, isWritable: true },
                { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
              ],
              programId: PROGRAM_ID_PUBKEY,
              data: Buffer.from(data),
            });

            const transaction = new Transaction();
            transaction.add(instruction);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            console.log("Calling signTransactions for claim timeout win...");
            const signedTransactions = await wallet.signTransactions({
              transactions: [transaction],
            });
            console.log("Transaction signed successfully");

            const txSignature = await connection.sendRawTransaction(
              signedTransactions[0].serialize(),
            );
            console.log("Transaction sent with signature:", txSignature);

            const confirmation = await connection.confirmTransaction(txSignature);
            console.log("Transaction confirmation:", confirmation);

            if (confirmation.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return txSignature;
          } catch (error: any) {
            console.error("Error in transact:", error);
            throw error;
          }
        });

        return signature;
      } catch (error) {
        console.error("Failed to claim timeout win:", error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  // 定期更新余额
  useEffect(() => {
    if (connected) {
      getBalance();
      const interval = setInterval(getBalance, 30000); // 每30秒更新一次
      return () => clearInterval(interval);
    }
  }, [connected, getBalance]);

  // 检查钱包连接状态
  const isWalletConnected = useCallback(() => {
    return !!publicKey && !!authToken;
  }, [publicKey, authToken]);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        connected,
        balance,
        connect,
        disconnect,
        sendSol,
        getBalance,
        loading,
        authToken,
        initializeConfig,
        joinBattle,
        createBattle,
        revealSeed,
        claimRefund,
        claimTimeoutWin,
        isWalletConnected,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
