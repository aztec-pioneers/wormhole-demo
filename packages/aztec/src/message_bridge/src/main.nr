use aztec::macros::aztec;

pub mod config;
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
        config::Config,
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
        // chain id => source chain address => is_registered
        registered_emitters: Map<u16, Map<Field, PublicImmutable<bool, Context>, Context>, Context>,

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
    ) {
        storage.config.initialize(Config::new(
            wormhole_address,
            chain_id,
            message_fee,
        ));
        storage.owner.write(owner);

        // Initialize last received values to zero
        storage.current_value.write(0);
    }

    #[external("public")]
    fn register_emitter(source_chain_id: u16, emitter_address: [u8; 32]) {
        // 1. check caller is admin
        let owner = storage.owner.read();
        assert(owner == context.msg_sender().unwrap(), "Caller is not owner");

        // 2. pack eth address into a field
        let  mut emitter_address_truncated = [0; 31];
        for i in 0..31 {
            emitter_address_truncated[i] = emitter_address[i + 1];
        }
        let emitter_address_field = Field::from_be_bytes(emitter_address_truncated);

        // 3. register emitter
        storage.registered_emitters
            .at(source_chain_id)
            .at(emitter_address_field)
            .initialize(true);
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
            1, // consistency level (1 = confirmed)
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
            1, // consistency level (1 = confirmed)
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

        // 4. validate emitter from VAA envelope (not sender from payload)
        let is_registered_emitter = storage.registered_emitters
            .at(vaa_envelope.emitter_chain_id)
            .at(vaa_envelope.emitter_as_field())
            .read();
        assert(is_registered_emitter, "Emitter not registered");

        // 5. emit the nullifier to prevent replays
        // note: will fail if nullifier has already been emitted
        context.push_nullifier(vaa_nullifier);

        // 6. update state with received value
        MessageBridge::at(context.this_address())
            ._update_value(vaa_payload.value)
            .enqueue(&mut context);
    }

    #[external("public")]
    #[internal]
    fn _update_value(value: u128) {
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
        // pack eth address into a field (take bytes 1-31 to preserve EVM address suffix)
        let mut emitter_address_truncated = [0; 31];
        for i in 0..31 {
            emitter_address_truncated[i] = emitter_address[i + 1];
        }
        let emitter_address_field = Field::from_be_bytes(emitter_address_truncated);

        storage.registered_emitters
            .at(chain_id)
            .at(emitter_address_field)
            .read()
    }

    #[external("utility")]
    unconstrained fn get_current_value() -> u128 {
        storage.current_value.read()
    }
}
