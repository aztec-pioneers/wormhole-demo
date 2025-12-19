use anchor_lang::prelude::*;
use std::io::{self, Write};
use wormhole_io::{Readable, Writeable};

/// Message payload for cross-chain value transfer
///
/// Outbound format (Solana -> other chains):
///   - destination_chain_id: u16 (2 bytes, big-endian)
///   - value: u128 (16 bytes, big-endian)
///   Total: 18 bytes
///
/// Inbound format (other chains -> Solana, after guardian adds txId):
///   - tx_id: [u8; 32] (32 bytes, added by guardian)
///   - destination_chain_id: u16 (2 bytes, big-endian)
///   - value: u128 (16 bytes, big-endian)
///   Total: 50 bytes
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueMessage {
    pub destination_chain_id: u16,
    pub value: u128,
}

impl ValueMessage {
    pub const PAYLOAD_SIZE: usize = 18; // 2 + 16

    /// Encode message for outbound transfer
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(Self::PAYLOAD_SIZE);
        buf.extend_from_slice(&self.destination_chain_id.to_be_bytes());
        buf.extend_from_slice(&self.value.to_be_bytes());
        buf
    }

    /// Decode message from inbound payload (without txId prefix)
    pub fn decode(data: &[u8]) -> Result<Self> {
        if data.len() < Self::PAYLOAD_SIZE {
            return Err(error!(crate::error::MessageBridgeError::InvalidPayload));
        }

        let destination_chain_id = u16::from_be_bytes([data[0], data[1]]);
        let value = u128::from_be_bytes(data[2..18].try_into().unwrap());

        Ok(Self {
            destination_chain_id,
            value,
        })
    }
}

/// Inbound message with txId (from Aztec Guardian)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InboundMessage {
    pub tx_id: [u8; 32],
    pub destination_chain_id: u16,
    pub value: u128,
}

impl InboundMessage {
    pub const PAYLOAD_SIZE: usize = 50; // 32 + 2 + 16

    /// Decode inbound message with txId prefix
    pub fn decode(data: &[u8]) -> Result<Self> {
        if data.len() < Self::PAYLOAD_SIZE {
            return Err(error!(crate::error::MessageBridgeError::InvalidPayload));
        }

        let mut tx_id = [0u8; 32];
        tx_id.copy_from_slice(&data[0..32]);

        let destination_chain_id = u16::from_be_bytes([data[32], data[33]]);
        let value = u128::from_be_bytes(data[34..50].try_into().unwrap());

        Ok(Self {
            tx_id,
            destination_chain_id,
            value,
        })
    }
}

impl Writeable for ValueMessage {
    fn write<W: Write>(&self, writer: &mut W) -> io::Result<()> {
        writer.write_all(&self.destination_chain_id.to_be_bytes())?;
        writer.write_all(&self.value.to_be_bytes())?;
        Ok(())
    }

    fn written_size(&self) -> usize {
        Self::PAYLOAD_SIZE
    }
}

impl Readable for ValueMessage {
    const SIZE: Option<usize> = Some(Self::PAYLOAD_SIZE);

    fn read<R: io::Read>(reader: &mut R) -> io::Result<Self> {
        let mut chain_bytes = [0u8; 2];
        reader.read_exact(&mut chain_bytes)?;
        let destination_chain_id = u16::from_be_bytes(chain_bytes);

        let mut value_bytes = [0u8; 16];
        reader.read_exact(&mut value_bytes)?;
        let value = u128::from_be_bytes(value_bytes);

        Ok(Self {
            destination_chain_id,
            value,
        })
    }
}
