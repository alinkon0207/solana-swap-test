const bs58 = require('bs58');
const { BN } = require('bn.js');
const {
    Liquidity,
    MAINNET_PROGRAM_ID,
    DEVNET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    Token,
    TxVersion,
} = require('@raydium-io/raydium-sdk');
const {
    clusterApiUrl,
    Connection,
    Keypair,
    PublicKey,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { Market, MARKET_STATE_LAYOUT_V3 } = require('@project-serum/serum');
const {
    buildAndSendTransactionList,
    getWalletTokenAccount,
} = require('./utils');
const { getMint } = require('@solana/spl-token');

const PROGRAMIDS = DEVNET_PROGRAM_ID;
const makeTxVersion = TxVersion.V0; // LEGACY

const endpoint = clusterApiUrl('devnet');
// const endpoint = "https://mainnet.helius-rpc.com/?api-key=fff6a34b-479e-49e7-9903-b04bddcdc463";
const connection = new Connection(endpoint, 'confirmed');

const payer = Keypair.fromSecretKey(bs58.decode('3kveXx1cDCVmM6bajczDmpZgkaxW1TSTFMvzupH42vjYJZ21PzvTocneGrGkGDi23CnMpraUWPpx8BYQyMwGZNiV'));
console.log("Payer:", payer.publicKey.toBase58());

/**
 *
 * step 1: create instructions by SDK function
 * step 2: compose instructions to several transactions
 * step 3: send transactions
 */
const createPool = async () => {
    const mint = new PublicKey("JBvoPaBwV6dstSYumhp42UegHMNW8dSnMFqhwJF6SqKB");
    const mintInfo = await getMint(connection, mint);
    console.log("Mint Info:", mintInfo.supply, mintInfo.decimals);

    const baseToken = new Token(TOKEN_PROGRAM_ID, mint.toBase58(), mintInfo.decimals);
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    const baseAmount = new BN(mintInfo.supply);
    const quoteAmount = new BN(2 * LAMPORTS_PER_SOL);
    const startTime = Math.floor(Date.now() / 1000);
    const walletTokenAccounts = await getWalletTokenAccount(connection, payer.publicKey);

    const [{ publicKey: marketId, /*accountInfo*/ }] = await Market.findAccountsByMints(connection, baseToken.mint, quoteToken.mint, PROGRAMIDS.OPENBOOK_MARKET);
    // const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
    // let poolKeys = Liquidity.getAssociatedPoolKeys({
    //     version: 4,
    //     marketVersion: 4,
    //     baseMint: baseToken.mint,
    //     quoteMint: quoteToken.mint,
    //     baseDecimals: baseToken.decimals,
    //     quoteDecimals: quoteToken.decimals,
    //     marketId: marketId,
    //     programId: PROGRAMIDS.AmmV4,
    //     marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
    // });
    // poolKeys.marketBaseVault = marketInfo.baseVault;
    // poolKeys.marketQuoteVault = marketInfo.quoteVault;
    // poolKeys.marketBids = marketInfo.bids;
    // poolKeys.marketAsks = marketInfo.asks;
    // poolKeys.marketEventQueue = marketInfo.eventQueue;
    // console.log("Pool Keys:", poolKeys);

    // const extraPoolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    // console.log("Extra Pool Info:", extraPoolInfo);

    const { innerTransactions, address } = await Liquidity.makeCreatePoolV4InstructionV2Simple({
        connection,
        programId: PROGRAMIDS.AmmV4,
        marketInfo: {
            marketId: marketId,
            programId: PROGRAMIDS.OPENBOOK_MARKET,
        },
        baseMintInfo: baseToken,
        quoteMintInfo: quoteToken,
        baseAmount: baseAmount,
        quoteAmount: quoteAmount,
        startTime: new BN(startTime),
        ownerInfo: {
            feePayer: payer.publicKey,
            wallet: payer.publicKey,
            tokenAccounts: walletTokenAccounts,
            useSOLBalance: true,
        },
        associatedOnly: false,
        checkCreateATAOwner: true,
        makeTxVersion,
        feeDestinationId: new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR"), // for devnet
        // feeDestinationId: new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"), // for mainnet
    });
    // console.log("Inner Transactions:", innerTransactions);
    // console.log("Address:", address);

    await buildAndSendTransactionList(connection, makeTxVersion, innerTransactions, payer);
}

createPool();
