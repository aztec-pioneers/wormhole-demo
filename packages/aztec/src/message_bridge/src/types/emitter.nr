use aztec::protocol_types::traits::Packable;

/// Emitter address which must be packed
#[derive(Eq)]
pub struct Emitter {
    pub address: [u8; 32]
}

impl Packable for Emitter {

    let N: u32 = 2;

    fn pack(self) -> [Field; Self::N] {
        let mut chunk_1_bytes = [0; 31];
        for i in 0..31 {
            chunk_1_bytes[i] = self.address[i];
        }
        let chunk_1 = Field::from_be_bytes(chunk_1_bytes);
        let chunk_2 = self.address[31] as Field;
        [chunk_1, chunk_2]
    }

    fn unpack(packed: [Field; Self::N]) -> Self {
        let chunk_1_bytes: [u8; 31] = Field::to_be_bytes(packed[0]);
        let mut address = [0; 32];
        for i in 0..31 {
            address[i] = chunk_1_bytes[i];
        }
        address[31] = packed[1] as u8;
        Self { address }
    }
} 
