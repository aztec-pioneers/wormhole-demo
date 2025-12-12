use anchor_lang::prelude::*;

#[error_code]
pub enum MessageBridgeError {
    #[msg("Only the owner can perform this action")]
    OwnerOnly,

    #[msg("Invalid Wormhole configuration")]
    InvalidWormholeConfig,

    #[msg("Invalid foreign emitter")]
    InvalidForeignEmitter,

    #[msg("Invalid destination chain ID")]
    InvalidDestinationChainId,

    #[msg("Cannot register emitter for Solana chain")]
    CannotRegisterSolanaEmitter,

    #[msg("Emitter address cannot be zero")]
    ZeroEmitterAddress,

    #[msg("Invalid message payload")]
    InvalidPayload,

    #[msg("Message already processed")]
    AlreadyProcessed,

    #[msg("Insufficient fee for Wormhole message")]
    InsufficientFee,
}
