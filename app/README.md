# Battle Arena

A fair PvP betting game powered by Solana blockchain

## 🎮 Overview

Battle Arena is a decentralized PvP betting platform where players use SOL tokens for fair and transparent battles. All game logic is executed on Solana smart contracts, ensuring tamper-proof results.

## 🎯 How to Play

### Game Flow

#### 1️⃣ Create a Battle
- Choose game type (Flip Card / Dice Roll)
- Set bet amount (e.g., 0.1 SOL)
- System generates a **random seed** (64-character hex string)
- ⚠️ **Important**: Save your seed safely - you'll need to reveal it later
- Battle enters **Waiting for Challenger** state

#### 2️⃣ Join a Battle
- Challenger selects a battle from the list
- Wagers the same amount of SOL as the creator
- Battle enters **Waiting for Creator Reveal** state

#### 3️⃣ Reveal Seed
- **Creator** must reveal their seed before timeout
- Enter the 64-character hex seed saved earlier
- System verifies the seed authenticity
- Battle proceeds to settlement

#### 4️⃣ Settlement
- Smart contract calculates the game result from both seeds
- **Winner** takes the entire pot (minus 1% fee)
- Battle completes, recorded on-chain

### Game Types

- **Flip Card**: Coin flip style game, 50/50 odds
- **Dice Roll**: Coming soon

### Timeout Protection

#### No Challenger Timeout
- If no one joins within a certain time after creation
- Creator can click **"Claim Refund"** to get their wager back
- System automatically refunds the SOL

#### Creator Non-Reveal Timeout
- If creator refuses to reveal seed after challenger joins
- Challenger can click **"Claim Timeout Win"** to win by timeout
- Challenger wins automatically without waiting

## 🛠 Tech Stack

### Frontend
- **React Native** - Cross-platform mobile framework
- **Expo** - Development and build tooling
- **TypeScript** - Type safety
- **Expo Router** - File-based routing

### Blockchain
- **Solana** - High-performance blockchain
- **Anchor** - Solana smart contract framework
- **Solana Mobile Wallet Adapter** - Mobile wallet integration

## 📱 Features

- ✅ Wallet connect/disconnect
- ✅ Create battles
- ✅ Browse and join battles
- ✅ Seed reveal mechanism
- ✅ Timeout protection
- ✅ Battle history
- ✅ Real-time status updates

## 🚀 Getting Started

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npx expo start
```

### Build Android APK

```bash
# Regenerate resources (includes latest icons)
npx expo prebuild --clean

# Build Release APK
cd android
./gradlew assembleRelease
```

Built APK location:
```
android/app/build/outputs/apk/release/app-release.apk
```

## 📋 Configuration

### Network Config

Configure RPC endpoint and program ID in `config/network.ts`:

```typescript
export const RPC_ENDPOINT = "https://api.devnet.solana.com";
export const PROGRAM_ID = "YOUR_PROGRAM_ID";
```

### App Icons

Configure app icons in `app.json`:

```json
{
  "expo": {
    "icon": "./assets/images/logo.png",
    "android": {
      "icon": "./assets/images/logo.png"
    }
  }
}
```

## ⚠️ Important Notes

1. **Save Your Seed**: The seed generated when creating a battle must be kept safe, or you cannot complete the battle
2. **Reveal Timely**: Creator must reveal seed before timeout, or forfeit automatically
3. **Network Fees**: Each transaction requires a small amount of SOL as gas fee
4. **Testnet**: Currently using Solana Devnet, get test tokens from faucet

## 🎨 App Screens

- **Home**: Browse available battles, create new battles
- **History**: View personal battle history
- **Battle Detail**: View battle details, execute actions

## 🔐 Security

- All game logic executed on Solana smart contracts
- Seed commitment scheme ensures fairness
- Timeout mechanisms prevent malicious behavior
- All transactions recorded on blockchain, publicly verifiable

## 📄 License

MIT License

## 🤝 Contributing

Issues and Pull Requests are welcome!
