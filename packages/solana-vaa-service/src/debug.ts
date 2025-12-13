import { Connection, PublicKey } from '@solana/web3.js';
import { keccak256 } from '@wormhole-foundation/sdk';

const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const WORMHOLE_PROGRAM_ID = '3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5';
const ACTUAL_POSTED_VAA = 'F7ymqcgAMTNhXcWNC7CR95qVmHzR4e1BvFxXSgkj1iGt';

async function main() {
    const connection = new Connection(SOLANA_RPC_URL);

    // Read the PostedVAA account data
    const actualPubkey = new PublicKey(ACTUAL_POSTED_VAA);
    const actualAccount = await connection.getAccountInfo(actualPubkey);

    if (!actualAccount) {
        console.log('Account not found');
        return;
    }

    const data = actualAccount.data;
    console.log('PostedVAA account:');
    console.log('  Raw hex:', data.toString('hex'));

    // Parse the SignatureSet address from PostedVAA
    // After "vaa\x01" (4 bytes) + consistency_level (1 byte) + timestamp (4 bytes) = 9 bytes
    // Then SignatureSet pubkey (32 bytes) at offset 9
    const signatureSet = new PublicKey(data.subarray(9, 41));
    console.log('\n  Signature set:', signatureSet.toBase58());

    // Check the SignatureSet account
    console.log('\n=== SignatureSet account ===');
    const sigSetAccount = await connection.getAccountInfo(signatureSet);
    if (!sigSetAccount) {
        console.log('SignatureSet not found');
        return;
    }

    const sigSetData = sigSetAccount.data;
    console.log('  Raw hex:', sigSetData.toString('hex'));
    console.log('  Length:', sigSetData.length);

    // SignatureSet structure (from Wormhole Solana):
    // - 1 byte: signatures_verified bitmap or just a marker
    // - 4 bytes: guardian_set_index (LE)
    // - 32 bytes: hash (the VAA body hash)
    // - remaining: guardian signatures (19 x 1 byte each for a bitmap, etc.)

    // Try extracting hash from offset 5 (after 1 + 4 bytes)
    const hashFromSigSet = sigSetData.subarray(5, 37);
    console.log('\n  Hash from offset 5-37:', hashFromSigSet.toString('hex'));

    const [pda5] = PublicKey.findProgramAddressSync(
        [Buffer.from('PostedVAA'), hashFromSigSet],
        new PublicKey(WORMHOLE_PROGRAM_ID)
    );
    console.log('  PDA from offset 5:', pda5.toBase58());
    console.log('  Match:', pda5.toBase58() === ACTUAL_POSTED_VAA);

    // Let me also try different offsets to be thorough
    for (let offset = 0; offset <= 9; offset++) {
        const hash = sigSetData.subarray(offset, offset + 32);
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from('PostedVAA'), hash],
            new PublicKey(WORMHOLE_PROGRAM_ID)
        );
        const match = pda.toBase58() === ACTUAL_POSTED_VAA;
        if (match) {
            console.log('\n*** FOUND MATCH at offset', offset, '***');
            console.log('  Hash:', hash.toString('hex'));
            console.log('  PDA:', pda.toBase58());
        }
    }
}

main().catch(console.error);
