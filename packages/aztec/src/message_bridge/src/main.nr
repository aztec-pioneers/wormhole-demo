use aztec::macros::aztec;

pub mod types;
pub mod utils;

#[aztec]
pub contract MessageBridge {
    use aztec::{
        macros::{
            functions::{initializer, external, internal},
            storage::storage,
        },
        protocol_types::address::AztecAddress,
        state_vars::{map::Map, public_mutable::PublicMutable, public_immutable::PublicImmutable},
    };
    use crate::{
        types::{config::Config, emitter::Emitter},
        utils::vaa::{encode_message_payload, decode_vaa},
    };
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

        // Registered emitters
        // chain id => emitter address (one emitter per chain)
        registered_emitters: Map<u16, PublicImmutable<Emitter, Context>, Context>,

        // currently stored value
        current_value: PublicMutable<u128, Context>,
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
        consistency: u8
    ) {
        storage.config.initialize(Config::new(
            wormhole_address,
            chain_id,
            message_fee,
            consistency
        ));
        storage.owner.write(owner);

        // Initialize last received values to zero
        storage.current_value.write(0);
    }

    /**
     * Register up to 8 emitter addresses for source chains
     *
     * @param source_chain_id The chain ID of the source chain
     */
    #[external("public")]
    fn register_emitter(
        source_chain_ids: BoundedVec<u16, 8>,
        emitter_addresses: BoundedVec<[u8; 32], 8>,
    ) {
        // 1. check caller is admin
        let owner = storage.owner.read();
        assert(owner == context.msg_sender().unwrap(), "Caller is not owner");

        // 2. check lengths match
        assert(
            source_chain_ids.len() == emitter_addresses.len(),
            "Source chain IDs and emitter addresses length mismatch"
        );
        // 3. register emitters (store full 32-byte addresses)
        for i in 0..8 {
            if i < source_chain_ids.len() {
                let source_chain_id = source_chain_ids.get_unchecked(i);
                let emitter_address = emitter_addresses.get_unchecked(i);
                storage.registered_emitters
                    .at(source_chain_id)
                    .initialize(Emitter { address: emitter_address });
            }
        }
    }

    // ============================================================================
    // SEND MESSAGE (Aztec -> EVM)
    // ============================================================================

    #[external("public")]
    fn send_value_public(
        destination_chain_id: u16,
        value: u128,
        fee_nonce: Field,
    ) {
        // no auth checks
        let caller = context.msg_sender().unwrap();
        let config = storage.config.read();

        // 1. Encode the message payload (just destination_chain_id + value)
        let wormhole_payload = encode_message_payload(value, destination_chain_id);

        // 2. Publish message publicly through Wormhole
        let _ = Wormhole::at(config.wormhole_address).publish_message_in_public(
            0, // nonce
            wormhole_payload,
            config.message_fee,
            config.consistency,
            caller,
            fee_nonce,
        ).call(&mut context);
    }

    #[external("private")]
    fn send_value_private(
        destination_chain_id: u16,
        value: u128,
        fee_nonce: Field,
    ) {
        // no auth checks
        let caller = context.msg_sender().unwrap();
        let config = storage.config.read();

        // 1. Encode the message payload (just destination_chain_id + value)
        let wormhole_payload = encode_message_payload(value, destination_chain_id);

        // 2. Publish message privately through Wormhole
        let _ = Wormhole::at(config.wormhole_address).publish_message_in_private(
            0, // nonce
            wormhole_payload,
            config.message_fee,
            config.consistency,
            caller,
            fee_nonce,
        ).call(&mut context);
    }

    // ============================================================================
    // RECEIVE MESSAGE (EVM -> Aztec)
    // ============================================================================
    
    #[external("private")]
    fn receive_value(vaa: [u8; 2000], length: u32) {
        // 1. verify the VAA through Wormhole
        let config = storage.config.read();
        Wormhole::at(config.wormhole_address).verify_vaa(vaa, length).call(&mut context);

        // 2. decode the VAA (envelope + payload) and compute vaa nullifier
        let (vaa_envelope, vaa_payload, vaa_nullifier) = decode_vaa(vaa);

        // 3. validate destination chain is this chain
        assert(
            vaa_payload.destination_chain_id == config.chain_id,
            "Invalid destination chain ID"
        );

        // 4. emit the nullifier to prevent replays
        // note: will fail if nullifier has already been emitted
        context.push_nullifier(vaa_nullifier);

        // 5. validate emitter and update state (done in public to read public storage)
        MessageBridge::at(context.this_address())
            ._validate_emitter_and_update_value(
                vaa_envelope.emitter_chain_id,
                vaa_envelope.emitter_address,
                vaa_payload.value,
            )
            .enqueue(&mut context);
    }

    #[external("public")]
    #[internal]
    fn _validate_emitter_and_update_value(
        emitter_chain_id: u16,
        emitter_address: [u8; 32],
        value: u128,
    ) {
        // Validate emitter from VAA envelope (not sender from payload)
        let registered_emitter = storage.registered_emitters
            .at(emitter_chain_id)
            .read().address;
        assert(registered_emitter == emitter_address, "Emitter not registered");

        // Update state with received value
        storage.current_value.write(value);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    #[external("utility")]
    unconstrained fn get_config() -> Config {
        storage.config.read()
    }

    #[external("utility")]
    unconstrained fn get_owner() -> AztecAddress {
        storage.owner.read()
    }

    #[external("utility")]
    unconstrained fn is_emitter_registered(chain_id: u16, emitter_address: [u8; 32]) -> bool {
        let registered_emitter = storage.registered_emitters
            .at(chain_id)
            .read().address;
        registered_emitter == emitter_address
    }

    #[external("utility")]
    unconstrained fn get_registered_emitter(chain_id: u16) -> [u8; 32] {
        storage.registered_emitters
            .at(chain_id)
            .read().address
    }

    #[external("utility")]
    unconstrained fn get_current_value() -> u128 {
        storage.current_value.read()
    }
}
