const bs58 = require('bs58');
const {
    ENDPOINT,
    RAYDIUM_MAINNET,
    TOKEN_PROGRAM_ID,
    jsonInfo2PoolKeys,
    Liquidity,
    Percent,
    Token,
    TokenAmount,
    TxVersion,
} = require('@raydium-io/raydium-sdk');
const {
    clusterApiUrl,
    Connection,
    Keypair,
} = require('@solana/web3.js');

const {
    buildAndSendTransactionList,
    getWalletTokenAccount,
} = require('./utils');

const makeTxVersion = TxVersion.V0; // LEGACY

const endpoint = clusterApiUrl('mainnet-beta');
const connection = new Connection(endpoint, 'confirmed');

const payer = Keypair.fromSecretKey(bs58.decode('3kveXx1cDCVmM6bajczDmpZgkaxW1TSTFMvzupH42vjYJZ21PzvTocneGrGkGDi23CnMpraUWPpx8BYQyMwGZNiV'));
console.log("Payer:", payer.publicKey.toBase58());

const swap = async() => {
    const baseToken = new Token(TOKEN_PROGRAM_ID, "Ekxye9ckVZXT1vymJNkgS3cVzWyf6e26hY8TNSjTyBi8", 9);
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    const walletTokenAccounts = await getWalletTokenAccount(connection, payer.publicKey);

    const targetPool = "Hww45tvYA9kqBTwEPWmS3kYgRLK6oUktWEqUbFPrVwd8";
    const slippage = new Percent(1, 100);
    const inputTokenAmount = new TokenAmount(baseToken, 900000, false);
    const outputToken = quoteToken;

    // -------- pre-action: get pool info --------
    const ammPool = await (await fetch(ENDPOINT + RAYDIUM_MAINNET.poolInfo)).json() // If the Liquidity pool is not required for routing, then this variable can be configured as undefined
    const targetPoolInfo = [...ammPool.official, ...ammPool.unOfficial].find((info) => info.id === targetPool);
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo);
    console.log(poolKeys);
    
    // -------- step 1: coumpute amount out --------
    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys: poolKeys,
        poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
        amountIn: inputTokenAmount,
        currencyOut: outputToken,
        slippage: slippage,
    });
  
    // -------- step 2: create instructions by SDK function --------
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            tokenAccounts: walletTokenAccounts,
            owner: payer.publicKey,
        },
        amountIn: inputTokenAmount,
        amountOut: minAmountOut,
        fixedSide: 'in',
        makeTxVersion,
    });
  
    console.log('amountOut:', amountOut.toFixed(), '  minAmountOut: ', minAmountOut.toFixed())
  
    await buildAndSendTransactionList(connection, makeTxVersion, innerTransactions, payer);
}

swap();
