use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};

declare_id!("FzPt8DvFfzG9GUA56Yp22DCPgj8qgm6McCVRKoVYyADK");

#[program]
pub mod battle_game {
    use super::*;

    /// 初始化平台配置账户
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        reveal_timeout_slots: u64,
        no_challenger_timeout_slots: u64,  // 新增：无挑战者超时时间
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.fee_bps = fee_bps;
        config.reveal_timeout_slots = reveal_timeout_slots;
        config.no_challenger_timeout_slots = no_challenger_timeout_slots;  // 新增
        config.battle_count = 0;
        Ok(())
    }

    /// 更新平台配置
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_fee_bps: Option<u16>,
        new_reveal_timeout_slots: Option<u64>,
        new_no_challenger_timeout_slots: Option<u64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;

        require!(
            ctx.accounts.authority.key() == config.authority,
            BattleGameError::Unauthorized
        );

        if let Some(fee) = new_fee_bps {
            require!(fee <= 10_000, BattleGameError::InvalidFeeBasisPoints);
            config.fee_bps = fee;
        }

        if let Some(timeout) = new_reveal_timeout_slots {
            config.reveal_timeout_slots = timeout;
        }

        if let Some(timeout) = new_no_challenger_timeout_slots {
            config.no_challenger_timeout_slots = timeout;
        }

        Ok(())
    }

    /// 创建对战 - 第一步：创建者存入 SOL 并提交 commit
    pub fn create_battle(
        ctx: Context<CreateBattle>,
        bet_amount: u64,
        commit_hash: [u8; 32],
        game_type: GameType,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // 验证押注金额
        require!(bet_amount > 0, BattleGameError::InvalidBetAmount);

        // 转移押注到 PDA（托管）
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.battle.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

        // 初始化对战账户
        let battle = &mut ctx.accounts.battle;
        let config = &ctx.accounts.config;

        battle.battle_id = config.battle_count;
        battle.creator = ctx.accounts.creator.key();
        battle.challenger = None;
        battle.bet_amount = bet_amount;
        battle.commit_creator = commit_hash;
        battle.commit_challenger = None;
        battle.seed_creator = None;
        battle.seed_challenger = None;
        battle.game_type = game_type;
        battle.state = BattleState::WaitingForChallenger;
        battle.winner = None;
        battle.created_at_slot = clock.slot;
        battle.joined_at_slot = None;
        battle.config_snapshot = ConfigSnapshot {
            fee_bps: config.fee_bps,
            reveal_timeout_slots: config.reveal_timeout_slots,
            no_challenger_timeout_slots: config.no_challenger_timeout_slots,
        };
        battle.bump = ctx.bumps.battle;

        // 增加对战计数
        let config = &mut ctx.accounts.config;
        config.battle_count = config.battle_count.checked_add(1).unwrap();

        // 计算截止时间
        let clock = Clock::get()?;
        let reveal_deadline = clock.slot + config.reveal_timeout_slots;
        let refund_deadline = clock.slot + config.no_challenger_timeout_slots;

        emit!(BattleCreated {
            battle_id: battle.battle_id,
            creator: battle.creator,
            bet_amount,
            created_at_slot: clock.slot,
            reveal_deadline_slot: reveal_deadline,
            refund_deadline_slot: refund_deadline,
        });

        msg!("Battle {} created", battle.battle_id);
        Ok(())
    }

    /// 加入对战并揭示种子 - 第二步：挑战者存入 SOL、提交 commit 并立即揭示种子
    ///
    /// 安全性分析：
    /// - 挑战者在加入时就揭示种子，创建者立即可以看到
    /// - 但创建者已经在步骤1提交了哈希承诺 H(A)，无法修改种子 A
    /// - 因此创建者无法根据挑战者的种子 B 来作弊
    /// - 这消除了信息不对称问题，无需等待超时
    pub fn join_battle(
        ctx: Context<JoinBattle>,
        bet_amount: u64,
        commit_hash: [u8; 32],
        seed: [u8; 32],  // 新增：挑战者立即揭示的种子
    ) -> Result<()> {
        let clock = Clock::get()?;

        let battle = &mut ctx.accounts.battle;

        // 验证对战状态
        require!(
            battle.state == BattleState::WaitingForChallenger,
            BattleGameError::InvalidBattleState
        );

        // 验证不是创建者自己
        require!(
            ctx.accounts.challenger.key() != battle.creator,
            BattleGameError::CannotChallengeSelf
        );

        // 验证押注金额匹配
        require!(
            bet_amount == battle.bet_amount,
            BattleGameError::BetAmountMismatch
        );

        // 验证种子的哈希匹配承诺（使用简化的 Keccak256 API）
        let commitment: [u8; 32] = Keccak256::digest(&seed).into();

        require!(
            commitment == commit_hash,
            BattleGameError::InvalidCommitment
        );

        // 转移押注到 PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.challenger.to_account_info(),
                to: battle.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, bet_amount)?;

        // 更新对战状态
        battle.challenger = Some(ctx.accounts.challenger.key());
        battle.commit_challenger = Some(commit_hash);
        battle.seed_challenger = Some(seed);  // 新增：立即存储挑战者的种子

         // 检查创建者是否也已经揭示（理论上不可能，但保持逻辑完整）
         if battle.seed_creator.is_some() {
             // 双方都已揭示，可以直接结算
             battle.state = BattleState::BothRevealed;
         } else {
             // 等待创建者揭示（此时创建者可以看到挑战者的种子）
             battle.state = BattleState::WaitingCreatorReveal;
             battle.joined_at_slot = Some(clock.slot);
         }

         // 计算揭示截止时间
         let reveal_deadline = clock.slot + battle.config_snapshot.reveal_timeout_slots;

        emit!(BattleJoined {
            battle_id: battle.battle_id,
            challenger: ctx.accounts.challenger.key(),
            joined_at_slot: clock.slot,
            reveal_deadline_slot: reveal_deadline,
        });

        msg!("Battle {} joined and challenger revealed", battle.battle_id);
        Ok(())
    }

    /// 揭示种子 - 第三步：创建者揭示他们的随机种子（挑战者已在加入时揭示）
    pub fn reveal_seed(ctx: Context<RevealSeed>, seed: [u8; 32]) -> Result<()> {
        let battle = &mut ctx.accounts.battle;
        let signer = ctx.accounts.signer.key();

        // 验证对战状态：允许在 WaitingCreatorReveal 状态下揭示
        require!(
            battle.state == BattleState::WaitingCreatorReveal,
            BattleGameError::InvalidBattleState
        );

        // 只允许创建者揭示
        require!(signer == battle.creator, BattleGameError::Unauthorized);

        // 验证未揭示
        require!(
            battle.seed_creator.is_none(),
            BattleGameError::AlreadyRevealed
        );

        // 计算哈希验证（使用简化的 Keccak256 API）
        let commitment: [u8; 32] = Keccak256::digest(&seed).into();

        // 验证哈希匹配
        require!(
            commitment == battle.commit_creator,
            BattleGameError::InvalidCommitment
        );

        battle.seed_creator = Some(seed);

        // 双方都已揭示，进入 BothRevealed 状态
        battle.state = BattleState::BothRevealed;

        emit!(SeedRevealed {
            battle_id: battle.battle_id,
            revealer: signer,
        });

        msg!("Creator revealed for battle {}", battle.battle_id);
        Ok(())
    }

    /// 结算对战 - 第四步：计算结果并分配奖励
    pub fn settle_battle(ctx: Context<SettleBattle>) -> Result<()> {
        let battle = &mut ctx.accounts.battle;

        // 验证状态：必须是双方都已揭示
        require!(
            battle.state == BattleState::BothRevealed,
            BattleGameError::InvalidBattleState
        );

        require!(battle.winner.is_none(), BattleGameError::AlreadySettled);

        // 获取种子
        let seed_creator = battle.seed_creator.unwrap();
        let seed_challenger = battle.seed_challenger.unwrap();
        let battle_id = battle.battle_id;
        let creator = battle.creator;
        let challenger = battle.challenger.unwrap();
        let bet_amount = battle.bet_amount;
        let game_type = battle.game_type;

        // 计算最终随机数（使用简化的 Keccak256 API）
        let battle_id_bytes = battle_id.to_le_bytes();
        let combined_seed = [
            &seed_creator[..],
            &seed_challenger[..],
            &battle_id_bytes[..],
        ]
        .concat();

        let final_hash: [u8; 32] = Keccak256::digest(&combined_seed).into();
        let final_random = u64::from_le_bytes(final_hash[0..8].try_into().unwrap());

        // 根据游戏类型决定胜负
        let winner_pubkey = match game_type {
            GameType::CoinFlip => {
                if final_random % 2 == 0 {
                    creator
                } else {
                    challenger
                }
            }
            GameType::DiceRoll => {
                let creator_roll = (final_random % 6) + 1;
                let challenger_roll = ((final_random >> 16) % 6) + 1;

                msg!(
                    "Dice roll - Creator: {}, Challenger: {}",
                    creator_roll,
                    challenger_roll
                );

                if creator_roll >= challenger_roll {
                    creator
                } else {
                    challenger
                }
            }
        };

        battle.winner = Some(winner_pubkey);
        battle.state = BattleState::Settled;

        // 计算奖励金额（使用 config_snapshot）
        let total_pot = bet_amount.checked_mul(2).unwrap();
        let fee = total_pot
            .checked_mul(battle.config_snapshot.fee_bps as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let winnings = total_pot.checked_sub(fee).unwrap();

        // 转账给胜者
        **ctx.accounts.battle.to_account_info().try_borrow_mut_lamports()? -= winnings;

        if winner_pubkey == ctx.accounts.creator.key() {
            **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += winnings;
        } else {
            **ctx.accounts.challenger.to_account_info().try_borrow_mut_lamports()? += winnings;
        }

        // 转账手续费到平台（如果有）
        if fee > 0 {
            **ctx.accounts.battle.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? += fee;
        }

        emit!(BattleSettled {
            battle_id,
            winner: winner_pubkey,
            amount: winnings,
        });

        msg!(
            "Battle {} settled. Winner: {:?}, Winnings: {}, Fee: {}",
            battle_id,
            winner_pubkey,
            winnings,
            fee
        );
        msg!("Final random: {}", final_random);

        Ok(())
    }

    /// 场景 1 退款：没有挑战者加入时，创建者可以取回押金
    ///
    /// 条件：
    /// - 对战处于 WaitingForChallenger 状态
    /// - 超过 no_challenger_timeout_slots 时间
    /// - 创建者取回全部押金（无惩罚）
    ///
    /// 这是公平的：因为没有人加入，创建者不应受到惩罚
    pub fn claim_refund_no_challenger(ctx: Context<ClaimRefundNoChallenger>) -> Result<()> {
        let clock = Clock::get()?;
        let battle = &mut ctx.accounts.battle;

        // 验证状态：必须还在等待挑战者
        require!(
            battle.state == BattleState::WaitingForChallenger,
            BattleGameError::InvalidBattleState
        );

        // 检查超时：使用 config_snapshot 中的超时配置
        let elapsed = clock.slot.saturating_sub(battle.created_at_slot);
        require!(
            elapsed > battle.config_snapshot.no_challenger_timeout_slots,
            BattleGameError::NotYetTimeout
        );

        let refund = battle.bet_amount;

        // 更新状态
        battle.state = BattleState::Settled;
        battle.winner = Some(battle.creator);  // 创建者获胜（拿回钱）

        // 转账：创建者取回全部押金
        **battle.to_account_info().try_borrow_mut_lamports()? -= refund;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += refund;

        msg!(
            "Battle {} refunded: no challenger joined. Refund: {}",
            battle.battle_id,
            refund
        );

        Ok(())
    }

    /// 场景 2 超时判负：挑战者已揭示，但创建者拒绝揭示，挑战者获胜
    ///
    /// 条件：
    /// - 对战处于 WaitingCreatorReveal 状态
    /// - 挑战者已揭示种子
    /// - 创建者未揭示
    /// - 超过较短的超时时间（如 100 slots）
    ///
    /// 这是公平的：创建者看到挑战者的种子后拒绝揭示，应该受到惩罚
    pub fn claim_creator_timeout_win(ctx: Context<ClaimCreatorTimeoutWin>) -> Result<()> {
        let clock = Clock::get()?;
        let battle = &mut ctx.accounts.battle;

        // 验证状态：等待创建者揭示
        require!(
            battle.state == BattleState::WaitingCreatorReveal,
            BattleGameError::InvalidBattleState
        );

        // 验证：挑战者已揭示，创建者未揭示
        require!(
            battle.seed_challenger.is_some(),
            BattleGameError::InvalidBattleState
        );
        require!(
            battle.seed_creator.is_none(),
            BattleGameError::InvalidBattleState
        );

        require!(battle.winner.is_none(), BattleGameError::AlreadySettled);

        // 检查超时：使用 config_snapshot 中的超时配置
        let elapsed = clock.slot.saturating_sub(battle.joined_at_slot.unwrap());
        require!(
            elapsed > battle.config_snapshot.reveal_timeout_slots,
            BattleGameError::NotYetTimeout
        );

        // 计算结果：创建者判负，挑战者获胜
        let challenger = battle.challenger.unwrap();
        let bet_amount = battle.bet_amount;
        let total_pot = bet_amount.checked_mul(2).unwrap();

        // 计算手续费和奖金（使用 config_snapshot）
        let fee = total_pot
            .checked_mul(battle.config_snapshot.fee_bps as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let winnings = total_pot.checked_sub(fee).unwrap();

        // 更新状态
        battle.winner = Some(challenger);
        battle.state = BattleState::Settled;

        // 转账给挑战者
        **battle.to_account_info().try_borrow_mut_lamports()? -= winnings;
        **ctx.accounts.challenger.to_account_info().try_borrow_mut_lamports()? += winnings;

        // 手续费给平台
        if fee > 0 {
            **battle.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_recipient.try_borrow_mut_lamports()? += fee;
        }

        msg!(
            "Battle {} settled by creator timeout. Winner: challenger",
            battle.battle_id
        );

        Ok(())
    }
}

// ============================================================================
// 账户结构
// ============================================================================

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub reveal_timeout_slots: u64,
    pub no_challenger_timeout_slots: u64,
    pub battle_count: u64,
}

/// 配置快照：在 battle 创建时保存配置，防止管理员修改影响已存在的 battle
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct ConfigSnapshot {
    pub fee_bps: u16,
    pub reveal_timeout_slots: u64,
    pub no_challenger_timeout_slots: u64,
}

/// 事件：Battle 创建
#[event]
pub struct BattleCreated {
    pub battle_id: u64,
    pub creator: Pubkey,
    pub bet_amount: u64,
    pub created_at_slot: u64,
    pub reveal_deadline_slot: u64,
    pub refund_deadline_slot: u64,
}

/// 事件：Battle 加入
#[event]
pub struct BattleJoined {
    pub battle_id: u64,
    pub challenger: Pubkey,
    pub joined_at_slot: u64,
    pub reveal_deadline_slot: u64,
}

/// 事件：种子揭示
#[event]
pub struct SeedRevealed {
    pub battle_id: u64,
    pub revealer: Pubkey,
}

/// 事件：Battle 结算
#[event]
pub struct BattleSettled {
    pub battle_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[account]
pub struct Battle {
    pub battle_id: u64,
    pub creator: Pubkey,
    pub challenger: Option<Pubkey>,
    pub bet_amount: u64,
    pub commit_creator: [u8; 32],
    pub commit_challenger: Option<[u8; 32]>,
    pub seed_creator: Option<[u8; 32]>,
    pub seed_challenger: Option<[u8; 32]>,
    pub game_type: GameType,
    pub state: BattleState,
    pub winner: Option<Pubkey>,
    pub created_at_slot: u64,
    pub joined_at_slot: Option<u64>,
    pub config_snapshot: ConfigSnapshot,  // ✅ 使用快照替代直接引用
    pub bump: u8,
}

// ============================================================================
// 指令上下文
// ============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateBattle<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Battle::SPACE,
        seeds = [
            b"battle",
            creator.key().as_ref(),
            config.battle_count.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub battle: Account<'info, Battle>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinBattle<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [
            b"battle",
            battle.creator.as_ref(),
            battle.battle_id.to_le_bytes().as_ref(),
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    #[account(mut)]
    pub challenger: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealSeed<'info> {
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        constraint = battle.creator == signer.key() || battle.challenger == Some(signer.key()) @ BattleGameError::Unauthorized,
        seeds = [
            b"battle",
            battle.creator.as_ref(),
            battle.battle_id.to_le_bytes().as_ref(),
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleBattle<'info> {
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [
            b"battle",
            battle.creator.as_ref(),
            battle.battle_id.to_le_bytes().as_ref(),
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    /// ✅ Creator account - will receive winnings if they win
    #[account(mut, constraint = creator.key() == battle.creator @ BattleGameError::Unauthorized)]
    pub creator: SystemAccount<'info>,

    /// ✅ Challenger account - will receive winnings if they win
    #[account(mut, constraint = challenger.key() == battle.challenger.unwrap() @ BattleGameError::Unauthorized)]
    pub challenger: SystemAccount<'info>,

    /// ✅ Fee recipient account (config PDA itself - fees stay in the program)
    /// CHECK: Config PDA that will receive fees
    #[account(
        mut,
        constraint = fee_recipient.key() == config.key() @ BattleGameError::Unauthorized
    )]
    pub fee_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRefundNoChallenger<'info> {
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        constraint = battle.creator == creator.key() @ BattleGameError::Unauthorized,
        seeds = [
            b"battle",
            battle.creator.as_ref(),
            battle.battle_id.to_le_bytes().as_ref(),
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimCreatorTimeoutWin<'info> {
    #[account(
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [
            b"battle",
            battle.creator.as_ref(),
            battle.battle_id.to_le_bytes().as_ref(),
        ],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,

    #[account(mut)]
    pub challenger: Signer<'info>,

    /// ✅ 修复：添加地址约束
    #[account(
        mut,
        constraint = config.authority == fee_recipient.key() @ BattleGameError::Unauthorized
    )]
    pub fee_recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// 枚举和辅助类型
// ============================================================================

/// 对战状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BattleState {
    WaitingForChallenger,
    WaitingCreatorReveal,  // 等待创建者揭示（挑战者已揭示）
    BothRevealed,
    Settled,
}

/// 游戏类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameType {
    CoinFlip,
    DiceRoll,
}

// ============================================================================
// 错误码
// ============================================================================

#[error_code]
pub enum BattleGameError {
    #[msg("Invalid battle state for this operation")]
    InvalidBattleState,

    #[msg("Unauthorized to perform this operation")]
    Unauthorized,

    #[msg("Invalid bet amount")]
    InvalidBetAmount,

    #[msg("Bet amount does not match")]
    BetAmountMismatch,

    #[msg("Cannot challenge yourself")]
    CannotChallengeSelf,

    #[msg("Invalid commitment hash")]
    InvalidCommitment,

    #[msg("Already revealed seed")]
    AlreadyRevealed,

    #[msg("Battle already settled")]
    AlreadySettled,

    #[msg("Reveal timeout not reached yet")]
    RevealTimeoutNotReached,

    #[msg("Reveal timeout exceeded")]
    RevealTimeout,

    #[msg("Invalid fee basis points (must be <= 10000)")]
    InvalidFeeBasisPoints,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Timeout not reached yet")]
    NotYetTimeout,
}

// ============================================================================
// 空间大小常量
// ============================================================================

impl Config {
    pub const SPACE: usize = 32 + // authority
        2 +  // fee_bps
        8 +  // reveal_timeout_slots
        8 +  // no_challenger_timeout_slots
        8;   // battle_count
}

impl Battle {
    pub const SPACE: usize = 8 +  // battle_id
        32 + // creator
        33 + // challenger (Option<Pubkey>)
        8 +  // bet_amount
        32 + // commit_creator
        33 + // commit_challenger (Option<[u8; 32]>)
        33 + // seed_creator (Option<[u8; 32]>)
        33 + // seed_challenger (Option<[u8; 32]>)
        1 +  // game_type
        1 +  // state
        33 + // winner (Option<Pubkey>)
        8 +  // created_at_slot
        9 +  // joined_at_slot (Option<u64>)
        18 + // config_snapshot (2 + 8 + 8)
        1;   // bump
}
