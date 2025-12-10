use aztec::macros::aztec;

pub mod types;
pub mod utils;

#[aztec]
pub contract MessageBridge {
    use aztec::{
        macros::{
            functions::{initializer, external},
            storage::storage,
        },
        protocol_types::{
            address::AztecAddress,
        },
        state_vars::{map::Map, public_mutable::PublicMutable, public_immutable::PublicImmutable},
    };
    use crate::types::{Config, RegisteredEmitter};
    use crate::utils::{encode_message_payload, address_to_bytes32};
    use wormhole::Wormhole;

    // ============================================================================
    // STORAGE
    // ============================================================================

    #[storage]
    struct Storage<Context> {
        // Core configuration (immutable after deployment)
        config: PublicImmutable<Config, Context>,

        // Owner/admin address
        owner: PublicMutable<AztecAddress, Context>,

        // Registered emitters: chain_id => RegisteredEmitter
        // Maps remote chain IDs to their trusted bridge contract addresses
        registered_emitters: Map<Field, PublicMutable<RegisteredEmitter, Context>, Context>,

        // Processed VAAs for replay protection: vaa_hash => processed
        processed_vaas: Map<Field, PublicMutable<bool, Context>, Context>,

        // Message fee for Wormhole (in wei)
        message_fee: PublicMutable<u128, Context>,

        // Last received message data (for testing/verification)
        last_received_value: PublicMutable<u8, Context>,
        last_received_from_chain: PublicMutable<u16, Context>,
        last_received_sender: PublicMutable<Field, Context>,
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    #[external("public")]
    #[initializer]
    fn constructor(
        wormhole_address: AztecAddress,
        chain_id: u16,
        owner: AztecAddress,
        message_fee: u128,
    ) {
        storage.config.initialize(Config::new(
            wormhole_address,
            chain_id,
        ));
        storage.owner.write(owner);
        storage.message_fee.write(message_fee);

        // Initialize last received values to zero
        storage.last_received_value.write(0);
        storage.last_received_from_chain.write(0);
        storage.last_received_sender.write(0);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    #[external("public")]
    fn register_emitter(
        chain_id: u16,
        emitter_address: [u8; 32],
    ) {
        let owner = storage.owner.read();
        assert(owner.eq(context.msg_sender().unwrap()), "Caller is not owner");

        let key = chain_id as Field;
        storage.registered_emitters.at(key).write(RegisteredEmitter::new(emitter_address, true));
    }

    #[external("public")]
    fn set_message_fee(fee: u128) {
        let owner = storage.owner.read();
        assert(owner.eq(context.msg_sender().unwrap()), "Caller is not owner");
        storage.message_fee.write(fee);
    }

    #[external("public")]
    fn transfer_ownership(new_owner: AztecAddress) {
        let owner = storage.owner.read();
        assert(owner.eq(context.msg_sender().unwrap()), "Caller is not owner");
        storage.owner.write(new_owner);
    }

    // ============================================================================
    // SEND MESSAGE (Aztec -> EVM)
    // ============================================================================

    #[external("public")]
    fn send_value(
        destination_chain_id: u16,
        value: u8,
        fee_nonce: Field,
    ) {
        let config = storage.config.read();
        let message_fee = storage.message_fee.read();
        let sender = context.msg_sender().unwrap();

        // Validate value is in range (1-256, where 0 represents 256)
        // Note: u8 naturally enforces 0-255, we'll treat 0 as 256

        // Encode the message payload
        let wormhole_payload = encode_message_payload(
            address_to_bytes32(sender),
            value,
            config.chain_id,
            destination_chain_id,
        );

        // Publish message through Wormhole
        let _ = Wormhole::at(config.wormhole_address).publish_message_in_public(
            0, // nonce
            wormhole_payload,
            message_fee,
            1, // consistency level (1 = confirmed)
            sender,
            fee_nonce,
        ).call(&mut context);
    }

    // ============================================================================
    // RECEIVE MESSAGE (EVM -> Aztec)
    // ============================================================================

    #[external("public")]
    fn receive_value(
        source_chain_id: u16,
        sender: Field,
        value: u8,
    ) {
        // 1. Verify emitter is registered for source chain
        let emitter_key = source_chain_id as Field;
        let registered_emitter = storage.registered_emitters.at(emitter_key).read();
        assert(registered_emitter.enabled, "Emitter not registered");

        // 2. Check replay protection using hash of message parameters
        // We create a unique hash from the source chain, sender, and value
        let vaa_hash = _compute_vaa_hash(
            source_chain_id,
            sender,
            value as Field,
        );
        let already_processed = storage.processed_vaas.at(vaa_hash).read();
        assert(!already_processed, "VAA already processed");
        storage.processed_vaas.at(vaa_hash).write(true);

        // 3. Store the received message
        storage.last_received_value.write(value);
        storage.last_received_from_chain.write(source_chain_id);
        storage.last_received_sender.write(sender);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    #[external("utility")]
    unconstrained fn get_config() -> pub Config {
        storage.config.read()
    }

    #[external("utility")]
    unconstrained fn get_owner() -> pub AztecAddress {
        storage.owner.read()
    }

    #[external("utility")]
    unconstrained fn get_registered_emitter(chain_id: u16) -> pub RegisteredEmitter {
        let key = chain_id as Field;
        storage.registered_emitters.at(key).read()
    }

    #[external("utility")]
    unconstrained fn get_message_fee() -> pub u128 {
        storage.message_fee.read()
    }

    #[external("utility")]
    unconstrained fn get_last_value() -> pub u8 {
        storage.last_received_value.read()
    }

    #[external("utility")]
    unconstrained fn get_last_from_chain() -> pub u16 {
        storage.last_received_from_chain.read()
    }

    #[external("utility")]
    unconstrained fn get_last_sender() -> pub Field {
        storage.last_received_sender.read()
    }

    #[external("utility")]
    unconstrained fn is_vaa_processed(
        source_chain_id: u16,
        sender: Field,
        value: Field,
    ) -> pub bool {
        let vaa_hash = _compute_vaa_hash(source_chain_id, sender, value);
        storage.processed_vaas.at(vaa_hash).read()
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    #[contract_library_method]
    fn _compute_vaa_hash(
        source_chain_id: u16,
        sender: Field,
        value: Field,
    ) -> Field {
        let chain_id_field = source_chain_id as Field;
        let hash = chain_id_field * 1000000000 + sender * 1000 + value;
        hash
    }
}
