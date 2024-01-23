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

const addLiquidity = async () => {
    // const marketId = new PublicKey("FbpxFRLnrqs79Bda7MLRyaxdicdFr4LhH6b7v6C6PTpY");
    const baseToken = new Token(TOKEN_PROGRAM_ID, "Ekxye9ckVZXT1vymJNkgS3cVzWyf6e26hY8TNSjTyBi8", 9);
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    const walletTokenAccounts = await getWalletTokenAccount(connection, payer.publicKey);

    const targetPool = "Hww45tvYA9kqBTwEPWmS3kYgRLK6oUktWEqUbFPrVwd8";
    const slippage = new Percent(1, 100);
    const baseAmount = new TokenAmount(baseToken, "1000000", false);
    const quoteAmount = new TokenAmount(quoteToken, "0.1", false);

    // -------- pre-action: fetch basic info --------
    const ammV2PoolData = await fetch(ENDPOINT + RAYDIUM_MAINNET.poolInfo).then((res) => res.json())
    const targetPoolInfo = [...ammV2PoolData.official, ...ammV2PoolData.unOfficial].find((poolInfo) => poolInfo.id === targetPool);

    console.log("Target Pool:", targetPoolInfo);

    // -------- step 1: compute another amount --------
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo);
    // const extraPoolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    // const { maxAnotherAmount, anotherAmount, liquidity } = Liquidity.computeAnotherAmount({
    //     poolKeys,
    //     poolInfo: { ...targetPoolInfo, ...extraPoolInfo },
    //     amount: baseAmount,
    //     anotherCurrency: quoteToken,
    //     slippage: slippage,
    // });

    // console.log('Adding liquidity info', {
    //     liquidity: liquidity.toString(), 
    //     liquidityD: extraPoolInfo.lpDecimals,
    //     maxAnotherAmount: maxAnotherAmount,
    // });

    // -------- step 2: make instructions --------
    const addLiquidityInstructionResponse = await Liquidity.makeAddLiquidityInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            owner: payer.publicKey,
            payer: payer.publicKey,
            tokenAccounts: walletTokenAccounts,
        },
        amountInA: baseAmount,
        // amountInB: maxAnotherAmount,
        amountInB: quoteAmount,
        fixedSide: 'a',
        makeTxVersion,
    });

    await buildAndSendTransactionList(connection, makeTxVersion, addLiquidityInstructionResponse.innerTransactions, payer);
}

addLiquidity();
