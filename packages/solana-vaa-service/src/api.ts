import express, { Request, Response } from 'express';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { wormhole, signSendWait, Wormhole, deserialize } from '@wormhole-foundation/sdk';
import solana from '@wormhole-foundation/sdk/solana';
import { getSolanaSignAndSendSigner } from '@wormhole-foundation/sdk-solana';
import bs58 from 'bs58';
import crypto from 'crypto';
import { WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET } from '@aztec-wormhole-demo/solana-sdk';

const PORT = parseInt(process.env.PORT || '3001', 10);
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || '';
const WORMHOLE_PROGRAM_ID = process.env.SOLANA_WORMHOLE_PROGRAM_ID || WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET;

if (!SOLANA_PRIVATE_KEY) {
    console.error('SOLANA_PRIVATE_KEY is required');
    process.exit(1);
}

// Parse private key (base58 encoded)
const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Derive Posted VAA PDA to check if VAA is already posted
function derivePostedVAAPDA(vaaHash: Buffer): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('PostedVAA'), vaaHash],
        new PublicKey(WORMHOLE_PROGRAM_ID)
    );
    return pda;
}

// Compute VAA body hash (double SHA256)
function computeVAAHash(vaaBytes: Buffer): Buffer {
    if (vaaBytes.length < 6) throw new Error('VAA too short');
    const sigCount = vaaBytes[5];
    const bodyStart = 6 + (sigCount * 66);
    const body = vaaBytes.subarray(bodyStart);
    const hash = crypto.createHash('sha256').update(
        crypto.createHash('sha256').update(body).digest()
    ).digest();
    return hash;
}

// Check if VAA is already posted
async function isVAAPosted(vaaHash: Buffer): Promise<boolean> {
    try {
        const postedVAAPDA = derivePostedVAAPDA(vaaHash);
        const account = await connection.getAccountInfo(postedVAAPDA);
        return account !== null;
    } catch {
        return false;
    }
}

// Initialize Wormhole SDK once
let whPromise: Promise<Wormhole<'Devnet'>> | null = null;

async function getWormhole(): Promise<Wormhole<'Devnet'>> {
    if (!whPromise) {
        // Configure the SDK with custom RPC URL for Solana
        whPromise = wormhole('Devnet', [solana], {
            chains: {
                Solana: {
                    rpc: SOLANA_RPC_URL,
                    contracts: {
                        coreBridge: WORMHOLE_PROGRAM_ID,
                    },
                },
            },
        });
    }
    return whPromise;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        payer: keypair.publicKey.toBase58(),
        wormholeProgram: WORMHOLE_PROGRAM_ID,
    });
});

// Post VAA endpoint
app.post('/post-vaa', async (req: Request, res: Response) => {
    try {
        const { vaa } = req.body;

        if (!vaa) {
            res.status(400).json({ error: 'Missing vaa in request body' });
            return;
        }

        const vaaBytes = Buffer.from(vaa, 'hex');
        console.log(`Posting VAA to Solana (${vaaBytes.length} bytes)...`);

        const vaaHash = computeVAAHash(vaaBytes);

        // Check if already posted
        if (await isVAAPosted(vaaHash)) {
            console.log('VAA already posted to Wormhole');
            res.json({
                success: true,
                signature: 'already_posted',
                message: 'VAA already posted to Wormhole',
                postedVAA: derivePostedVAAPDA(vaaHash).toBase58(),
            });
            return;
        }

        // Initialize Wormhole SDK
        console.log('Initializing Wormhole SDK...');
        const wh = await getWormhole();

        // Get Solana chain context
        const chain = wh.getChain('Solana');

        // Deserialize VAA bytes into a VAA object
        console.log('Deserializing VAA...');
        const parsedVaa = deserialize('Uint8Array', new Uint8Array(vaaBytes));
        console.log(`Parsed VAA: emitter=${parsedVaa.emitterChain}, sequence=${parsedVaa.sequence}`);

        // Create a proper signer using the SDK's helper
        console.log('Creating signer...');
        const signer = await getSolanaSignAndSendSigner(connection, keypair, {
            debug: true,
            retries: 3,
        });

        // Get the core bridge
        const coreBridge = await chain.getWormholeCore();

        // Verify/post the VAA using the core bridge with the parsed VAA object
        console.log('Posting VAA via Wormhole SDK...');
        const verifyTxs = coreBridge.verifyMessage(signer.address(), parsedVaa);

        // Sign and send the verification transactions
        const txids = await signSendWait(chain, verifyTxs, signer);

        const lastTxid = txids[txids.length - 1];
        console.log(`VAA posted successfully: ${lastTxid?.txid || 'unknown'}`);

        res.json({
            success: true,
            signature: lastTxid?.txid || 'posted',
            wormholeProgramId: WORMHOLE_PROGRAM_ID,
        });
    } catch (error: any) {
        console.error('Failed to post VAA:', error);

        // Check if already posted (race condition)
        try {
            const vaaHash = computeVAAHash(Buffer.from(req.body.vaa, 'hex'));
            if (await isVAAPosted(vaaHash)) {
                res.json({
                    success: true,
                    signature: 'already_posted',
                    message: 'VAA already posted (verified on retry)',
                    postedVAA: derivePostedVAAPDA(vaaHash).toBase58(),
                });
                return;
            }
        } catch {}

        // Check for "already in use" error
        if (error.message?.includes('already in use') || error.message?.includes('already exists')) {
            res.json({
                success: true,
                signature: 'already_posted',
                message: 'VAA already posted to Wormhole',
            });
            return;
        }

        res.status(500).json({
            error: error.message || 'Failed to post VAA',
            details: error.logs || undefined,
        });
    }
});

app.listen(PORT, () => {
    console.log(`Solana VAA Service listening on port ${PORT}`);
    console.log(`  Solana RPC: ${SOLANA_RPC_URL}`);
    console.log(`  Wormhole Program: ${WORMHOLE_PROGRAM_ID}`);
    console.log(`  Payer: ${keypair.publicKey.toBase58()}`);
});
