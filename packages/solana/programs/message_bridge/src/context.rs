use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole::{self, program::Wormhole};

use crate::error::MessageBridgeError;
use crate::state::*;

/// Context for initializing the program
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Program owner who pays for account creation
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Config account (PDA)
    #[account(
        init,
        payer = owner,
        space = Config::SPACE,
        seeds = [Config::SEED_PREFIX],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Current value storage account (PDA)
    #[account(
        init,
        payer = owner,
        space = CurrentValue::SPACE,
        seeds = [CurrentValue::SEED_PREFIX],
        bump
    )]
    pub current_value: Account<'info, CurrentValue>,

    /// Wormhole emitter account (PDA)
    #[account(
        init,
        payer = owner,
        space = WormholeEmitter::SPACE,
        seeds = [WormholeEmitter::SEED_PREFIX],
        bump
    )]
    pub wormhole_emitter: Account<'info, WormholeEmitter>,

    /// Wormhole program
    pub wormhole_program: Program<'info, Wormhole>,

    /// Wormhole bridge data account
    /// CHECK: Verified by Wormhole program seeds
    #[account(
        mut,
        seeds = [b"Bridge"],
        bump,
        seeds::program = wormhole_program.key()
    )]
    pub wormhole_bridge: AccountInfo<'info>,

    /// Wormhole fee collector
    /// CHECK: Verified by Wormhole program seeds
    #[account(
        mut,
        seeds = [b"fee_collector"],
        bump,
        seeds::program = wormhole_program.key()
    )]
    pub wormhole_fee_collector: AccountInfo<'info>,

    /// Wormhole sequence account (will be created)
    #[account(
        mut,
        seeds = [
            wormhole::SequenceTracker::SEED_PREFIX,
            wormhole_emitter.key().as_ref()
        ],
        bump,
        seeds::program = wormhole_program.key()
    )]
    /// CHECK: Wormhole sequence account, initialized by Wormhole program
    pub wormhole_sequence: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
}

/// Context for registering a foreign emitter
#[derive(Accounts)]
#[instruction(chain_id: u16)]
pub struct RegisterEmitter<'info> {
    /// Program owner
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Config account (must match owner)
    #[account(
        seeds = [Config::SEED_PREFIX],
        bump,
        has_one = owner @ MessageBridgeError::OwnerOnly
    )]
    pub config: Account<'info, Config>,

    /// Foreign emitter account to create (PDA by chain_id)
    #[account(
        init,
        payer = owner,
        space = ForeignEmitter::SPACE,
        seeds = [ForeignEmitter::SEED_PREFIX, &chain_id.to_le_bytes()],
        bump
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    pub system_program: Program<'info, System>,
}

/// Context for sending a value to another chain
#[derive(Accounts)]
pub struct SendValue<'info> {
    /// Payer for Wormhole fee
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Config account
    #[account(
        mut,
        seeds = [Config::SEED_PREFIX],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Wormhole emitter (PDA that signs messages)
    #[account(
        seeds = [WormholeEmitter::SEED_PREFIX],
        bump = wormhole_emitter.bump,
    )]
    pub wormhole_emitter: Account<'info, WormholeEmitter>,

    /// Wormhole program
    pub wormhole_program: Program<'info, Wormhole>,

    /// Wormhole bridge data
    /// CHECK: Verified by address constraint
    #[account(
        mut,
        address = config.wormhole_bridge @ MessageBridgeError::InvalidWormholeConfig
    )]
    pub wormhole_bridge: AccountInfo<'info>,

    /// Wormhole fee collector
    /// CHECK: Verified by address constraint
    #[account(
        mut,
        address = config.wormhole_fee_collector @ MessageBridgeError::InvalidWormholeConfig
    )]
    pub wormhole_fee_collector: AccountInfo<'info>,

    /// Wormhole sequence tracker
    #[account(
        mut,
        address = config.wormhole_sequence @ MessageBridgeError::InvalidWormholeConfig
    )]
    /// CHECK: Wormhole sequence account
    pub wormhole_sequence: AccountInfo<'info>,

    /// Wormhole message account (PDA)
    #[account(
        mut,
        seeds = [
            b"message",
            &config.nonce.to_le_bytes()
        ],
        bump
    )]
    /// CHECK: Wormhole message account, created by this program
    pub wormhole_message: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
}

/// Context for receiving a value from another chain
#[derive(Accounts)]
#[instruction(vaa_hash: [u8; 32], emitter_chain: u16, sequence: u64)]
pub struct ReceiveValue<'info> {
    /// Payer for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Config account
    #[account(
        seeds = [Config::SEED_PREFIX],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Current value storage (to update)
    #[account(
        mut,
        seeds = [CurrentValue::SEED_PREFIX],
        bump,
    )]
    pub current_value: Account<'info, CurrentValue>,

    /// Wormhole program
    pub wormhole_program: Program<'info, Wormhole>,

    /// Posted VAA account (verified by Wormhole)
    /// CHECK: Verified by Wormhole program, we parse the data manually
    #[account(
        owner = wormhole_program.key()
    )]
    pub posted_vaa: AccountInfo<'info>,

    /// Foreign emitter (must match VAA emitter - validation done in instruction)
    #[account(
        seeds = [
            ForeignEmitter::SEED_PREFIX,
            &emitter_chain.to_le_bytes()
        ],
        bump,
    )]
    pub foreign_emitter: Account<'info, ForeignEmitter>,

    /// Received message account (for replay protection)
    #[account(
        init,
        payer = payer,
        space = ReceivedMessage::SPACE,
        seeds = [
            ReceivedMessage::SEED_PREFIX,
            &emitter_chain.to_le_bytes(),
            &sequence.to_le_bytes()
        ],
        bump
    )]
    pub received_message: Account<'info, ReceivedMessage>,

    pub system_program: Program<'info, System>,
}

