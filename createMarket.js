const bs58 = require('bs58');
const {
    MarketV2,
    Token,
    DEVNET_PROGRAM_ID,
    MAINNET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    MARKET_STATE_LAYOUT_V2,
    TxVersion,
} = require('@raydium-io/raydium-sdk');
const {
    clusterApiUrl,
    Keypair,
    Connection,
} = require('@solana/web3.js');
const { buildAndSendTransactionList } = require("./utils");

const PROGRAMIDS = DEVNET_PROGRAM_ID;
const makeTxVersion = TxVersion.V0; // LEGACY

const endpoint = clusterApiUrl('devnet');
const connection = new Connection(endpoint, 'confirmed');

const payer = Keypair.fromSecretKey(bs58.decode('3kveXx1cDCVmM6bajczDmpZgkaxW1TSTFMvzupH42vjYJZ21PzvTocneGrGkGDi23CnMpraUWPpx8BYQyMwGZNiV'));
console.log("Payer:", payer.publicKey.toBase58());

/**
 * step 1: make instructions
 * step 2: compose instructions to several transactions
 * step 3: send transactions
 */
const createMarket = async () => {
    // console.log(MARKET_STATE_LAYOUT_V2.span, await connection.getMinimumBalanceForRentExemption(MARKET_STATE_LAYOUT_V2.span));
    // console.log(5120 + 12, await connection.getMinimumBalanceForRentExemption(5120 + 12));
    // console.log(262144 + 12, await connection.getMinimumBalanceForRentExemption(262144 + 12));
    // console.log(65536 + 12, await connection.getMinimumBalanceForRentExemption(65536 + 12));
    // console.log(65536 + 12, await connection.getMinimumBalanceForRentExemption(65536 + 12));

    const baseToken = new Token(TOKEN_PROGRAM_ID, "JBvoPaBwV6dstSYumhp42UegHMNW8dSnMFqhwJF6SqKB", 9); // 
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    
    // -------- step 1: make instructions --------
    const { innerTransactions, address } = await MarketV2.makeCreateMarketInstructionSimple({
        connection,
        wallet: payer.publicKey,
        baseInfo: baseToken,
        quoteInfo: quoteToken,
        lotSize: 1, // default 1
        tickSize: 0.000001, // default 0.01
        dexProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        makeTxVersion,
    });
    // console.log(innerTransactions);

    await buildAndSendTransactionList(connection, makeTxVersion, innerTransactions, payer);
    console.log("Created market id:", address.marketId.toBase58());
}

createMarket();
