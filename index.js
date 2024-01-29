const dotenv = require("dotenv");
const bs58 = require("bs58");
const BN = require("bn.js");
const BigNumber = require("bignumber.js");

const {
    clusterApiUrl,
    Connection,
    PublicKey,
    Transaction,
    VersionedTransaction,
} = require("@solana/web3.js");

const {
    createMint,
    getMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    AuthorityType,
    setAuthority,
} = require("@solana/spl-token");

const {
    MarketV2,
    Token,
    Liquidity,
    TokenAmount,
    Percent,
    LOOKUP_TABLE_CACHE,
    MAINNET_PROGRAM_ID,
    DEVNET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SPL_ACCOUNT_LAYOUT,
    TxVersion,
    buildSimpleTransaction,
} = require("@raydium-io/raydium-sdk");

const {
    createCreateMetadataAccountV3Instruction,
    PROGRAM_ID,
} = require("@metaplex-foundation/mpl-token-metadata");

const { Market, MARKET_STATE_LAYOUT_V3 } = require("@project-serum/serum");
const { getKeypairFromEnvironment } = require("@solana-developers/node-helpers");

dotenv.config();

const DEVNET_MODE = process.env.DEVNET_MODE === "true";
const PROGRAMIDS = DEVNET_MODE ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID;
const addLookupTableInfo = DEVNET_MODE ? undefined : LOOKUP_TABLE_CACHE;
const TIMER = process.env.TIME_PERIOD;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

const makeTxVersion = TxVersion.V0; // LEGACY
const connection = new Connection(DEVNET_MODE ? clusterApiUrl("devnet") : process.env.MAINNET_RPC_URL, "confirmed");

const payer = getKeypairFromEnvironment("PAYER_SECRET_KEY");
const buyerOrSeller = getKeypairFromEnvironment("BUYER_SELLER_SECRET_KEY");

const args = process.argv;

console.log("Payer:", payer.publicKey.toBase58());
console.log("Mode:", DEVNET_MODE ? "devnet" : "mainnet");

const xWeiAmount = (amount, decimals) => {
    return new BN(new BigNumber(amount.toString() + "e" + decimals.toString()).toFixed(0));
};

const xReadableAmount = (amount, decimals) => {
    return new BN(new BigNumber(amount.toString() + "e-" + decimals.toString()).toFixed(0));
};

const getWalletTokenAccount = async (connection, wallet) => {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
};

const sendAndConfirmTransactions = async (connection, payer, transactions) => {
    console.log("payer:", payer);
    for (const tx of transactions) {
        let signature;
        if (tx instanceof VersionedTransaction) {
            tx.sign([payer]);
            signature = await connection.sendTransaction(tx);
        }
        else
            signature = await connection.sendTransaction(tx, [payer]);
        await connection.confirmTransaction(signature);
    }
};

const disableFreezeAuthority = async (mintAddress) => {
    console.log("Disabling freeze authority...", mintAddress);
    const mint = new PublicKey(mintAddress);
    await setAuthority(
        connection,
        payer,
        mint,
        payer.publicKey,
        AuthorityType.FreezeAccount,
        null
    );
    console.log("Freeze authority disabled successfully");
}

const createPool = async (mintAddress, tokenAmount, solAmount) => {
    console.log("Creating pool...", mintAddress, tokenAmount, solAmount);

    const mint = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mint);
    const baseToken = new Token(TOKEN_PROGRAM_ID, mintAddress, mintInfo.decimals);
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");

    const accounts = await Market.findAccountsByMints(connection, baseToken.mint, quoteToken.mint, PROGRAMIDS.OPENBOOK_MARKET);
    if (accounts.length === 0) {
        console.log("Not found OpenBook market!");
        return;
    }
    const marketId = accounts[0].publicKey;

    const startTime = Math.floor(Date.now() / 1000);
    const baseAmount = xWeiAmount(tokenAmount, mintInfo.decimals);
    const quoteAmount = xWeiAmount(solAmount, 9);
    const walletTokenAccounts = await getWalletTokenAccount(connection, payer.publicKey);

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
        makeTxVersion: makeTxVersion,
        feeDestinationId:
            DEVNET_MODE ? new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR")
                : new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5"), // only mainnet use this
    });

    const transactions = await buildSimpleTransaction({
        connection: connection,
        makeTxVersion: makeTxVersion,
        payer: payer.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: addLookupTableInfo,
    });

    await sendAndConfirmTransactions(connection, payer, transactions);
    console.log("AMM ID:", address.ammId.toBase58());
};

const buyToken = async (mintAddress, tokenAmount) => {
    console.log("Buying tokens...", mintAddress, tokenAmount);

    const mint = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mint);
    const baseToken = new Token(TOKEN_PROGRAM_ID, mintAddress, mintInfo.decimals, 'MyTestToken', 'MTT');
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    const walletTokenAccounts = await getWalletTokenAccount(connection, buyerOrSeller.publicKey);

    const slippage = new Percent(1, 100);
    const outputTokenAmount = new TokenAmount(baseToken, tokenAmount, false);

    const [{ publicKey: marketId, accountInfo }] = await Market.findAccountsByMints(connection, baseToken.mint, quoteToken.mint, PROGRAMIDS.OPENBOOK_MARKET);
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
    let poolKeys = Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        baseMint: baseToken.mint,
        quoteMint: quoteToken.mint,
        baseDecimals: baseToken.decimals,
        quoteDecimals: quoteToken.decimals,
        marketId: marketId,
        programId: PROGRAMIDS.AmmV4,
        marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
    });
    // console.log("Pool Keys:", poolKeys);
    poolKeys.marketBaseVault = marketInfo.baseVault;
    poolKeys.marketQuoteVault = marketInfo.quoteVault;
    poolKeys.marketBids = marketInfo.bids;
    poolKeys.marketAsks = marketInfo.asks;
    poolKeys.marketEventQueue = marketInfo.eventQueue;
    // console.log("Pool Keys:", poolKeys);

    // -------- step 1: compute amount in --------
    const { amountIn, maxAmountIn } = Liquidity.computeAmountIn({
        poolKeys: poolKeys,
        poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
        amountOut: outputTokenAmount,
        currencyIn: quoteToken,
        slippage: slippage,
    });
    console.log('amountIn:', amountIn.toFixed(), '  maxAmountIn:', maxAmountIn.toFixed())

    // -------- step 2: create instructions by SDK function --------
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            tokenAccounts: walletTokenAccounts,
            owner: buyerOrSeller.publicKey,
        },
        amountIn: maxAmountIn,
        amountOut: outputTokenAmount,
        fixedSide: 'out',
        makeTxVersion,
    });

    const transactions = await buildSimpleTransaction({
        connection: connection,
        makeTxVersion: makeTxVersion,
        payer: buyerOrSeller.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: addLookupTableInfo,
    });
    // console.log("transactions:", transactions);

    await sendAndConfirmTransactions(connection, buyerOrSeller, transactions);
    console.log("Success!!!");
}

const sellToken = async (mintAddress, tokenAmount) => {
    console.log("Selling tokens...", mintAddress, tokenAmount);

    const mint = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mint);
    const baseToken = new Token(TOKEN_PROGRAM_ID, mintAddress, mintInfo.decimals, 'MyTestToken', 'MTTK');
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
    const walletTokenAccounts = await getWalletTokenAccount(connection, buyerOrSeller.publicKey);

    const slippage = new Percent(1, 100);
    const inputTokenAmount = new TokenAmount(baseToken, tokenAmount, false);

    const [{ publicKey: marketId, accountInfo }] = await Market.findAccountsByMints(connection, baseToken.mint, quoteToken.mint, PROGRAMIDS.OPENBOOK_MARKET);
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(accountInfo.data);
    let poolKeys = Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        baseMint: baseToken.mint,
        quoteMint: quoteToken.mint,
        baseDecimals: baseToken.decimals,
        quoteDecimals: quoteToken.decimals,
        marketId: marketId,
        programId: PROGRAMIDS.AmmV4,
        marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
    });
    console.log("poolKeys:", poolKeys);
    poolKeys.marketBaseVault = marketInfo.baseVault;
    poolKeys.marketQuoteVault = marketInfo.quoteVault;
    poolKeys.marketBids = marketInfo.bids;
    poolKeys.marketAsks = marketInfo.asks;
    poolKeys.marketEventQueue = marketInfo.eventQueue;
    // console.log("Pool Keys:", poolKeys);

    // -------- step 1: compute amount out --------
    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
        poolKeys: poolKeys,
        poolInfo: await Liquidity.fetchInfo({ connection, poolKeys }),
        amountIn: inputTokenAmount,
        currencyOut: quoteToken,
        slippage: slippage,
    });
    // console.log('amountOut:', amountOut.toFixed(), '  minAmountOut: ', minAmountOut.toFixed())

    // -------- step 2: create instructions by SDK function --------
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
        connection,
        poolKeys,
        userKeys: {
            tokenAccounts: walletTokenAccounts,
            owner: buyerOrSeller.publicKey,
        },
        amountIn: inputTokenAmount,
        amountOut: minAmountOut,
        fixedSide: 'in',
        makeTxVersion,
    });

    const transactions = await buildSimpleTransaction({
        connection: connection,
        makeTxVersion: makeTxVersion,
        payer: buyerOrSeller.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: addLookupTableInfo,
    });

    await sendAndConfirmTransactions(connection, buyerOrSeller, transactions);
    console.log("Sell function is Success!!!");
}

const mintToken = async (mintAddress, amount) => {
    console.log("Minting tokens...", mintAddress, amount);
    const mint = new PublicKey(mintAddress);
    let mintInfo = await getMint(connection, mint);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
    const tokenAmount = xWeiAmount(amount, mintInfo.decimals);
    await mintTo(connection, payer, mint, tokenAccount.address, payer, tokenAmount);

    mintInfo = await getMint(connection, mint);
    const supply = xReadableAmount(mintInfo.supply, mintInfo.decimals);
    console.log("Mint Address:", mintInfo.address.toBase58(), "Decimals:", mintInfo.decimals, "Supply:", supply.toString());
}

const createMetaData = async (mintAddress, name, symbol) => {
    console.log("Creating meta-data...", mintAddress, name, symbol);
    // const metaplex = Metaplex.make(connection).use(keypairIdentity(payer));
    const mint = new PublicKey(mintAddress);
    const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            PROGRAM_ID.toBuffer(),
            mint.toBuffer()
        ],
        PROGRAM_ID
    );
    console.log("METADATA_PDA:", metadataPDA.toBase58());

    const tokenMetadata = {
        name: name,
        symbol: symbol,
        uri: "",
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
    };
    const transaction = new Transaction().add(
        createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataPDA,
                mint: mint,
                mintAuthority: payer.publicKey,
                payer: payer.publicKey,
                updateAuthority: payer.publicKey,
            },
            {
                createMetadataAccountArgsV3: {
                    data: tokenMetadata,
                    isMutable: true,
                    collectionDetails: null,
                },
            }
        )
    );

    await sendAndConfirmTransactions(connection, payer, [transaction]);
};

const createOpenBookMarket = async (mintAddress, minOrderSize, tickSize) => {
    console.log("Creating OpenBook market...", mintAddress);

    const mint = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mint);

    const baseToken = new Token(TOKEN_PROGRAM_ID, mintAddress, mintInfo.decimals);
    const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");

    const { innerTransactions, address } = await MarketV2.makeCreateMarketInstructionSimple({
        connection,
        wallet: payer.publicKey,
        baseInfo: baseToken,
        quoteInfo: quoteToken,
        lotSize: minOrderSize, // default 1
        tickSize: tickSize, // default 0.01
        dexProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        makeTxVersion,
    });

    const transactions = await buildSimpleTransaction({
        connection,
        makeTxVersion,
        payer: payer.publicKey,
        innerTransactions,
        addLookupTableInfo,
    });

    await sendAndConfirmTransactions(connection, payer, transactions);
    console.log("Market ID:", address.marketId.toBase58());
};

const createToken = async (name, symbol, decimals, totalSupply) => {
    console.log("Creating tokens...", name, symbol, decimals, totalSupply);
    const mint = await createMint(connection, payer, payer.publicKey, null, decimals);
    console.log("Mint Address:", mint.toBase58());

    await mintToken(mint.toBase58(), totalSupply);
    await createMetaData(mint.toBase58(), name, symbol);
    await createOpenBookMarket(mint.toBase58(), 1, 0.000001);

    console.log("============================================");
    console.log(`***** Mint Address: ${mint.toBase58()} *****`);
    console.log("============================================");
}


// createToken("MyTestToken", "MTT", 6, 1000000000);
//  mintToken("7VpmJYZG3y5tFzX6yY5HzmC82MzgVoGZAnCgsmjVPpE9", 1000000);
//  createOpenBookMarket("CCxdU4oAcF7upb6QYtgYXnEAiSRdBwW3gxSoCgjv2ocX", 1, 0.000001);
//  disableFreezeAuthority("Ekxye9ckVZXT1vymJNkgS3cVzWyf6e26hY8TNSjTyBi8");

// createPool(TOKEN_ADDRESS, 800000000, 1);

// sellToken(TOKEN_ADDRESS, 1000);
buyToken(TOKEN_ADDRESS, 1000);

// let timer = setInterval(() => {
//     if (args.length > 3) {
//         if (args[2] === "sell")
//             sellToken(TOKEN_ADDRESS, args[3]);
//         else if (args[2] === "buy")
//             buyToken(TOKEN_ADDRESS, args[3])
//     } else {
//         console.log('Please set the token amount!');
//     }
// }, TIMER);
