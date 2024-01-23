const {
    LOOKUP_TABLE_CACHE,
    TxVersion,
    TOKEN_PROGRAM_ID,
    SPL_ACCOUNT_LAYOUT,
} = require('@raydium-io/raydium-sdk');
const {
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} = require('@solana/web3.js');

const addLookupTableInfo = undefined; //LOOKUP_TABLE_CACHE; // only mainnet. other = undefined

function _makeTransaction({
    txVersion,
    instructions,
    payer,
    recentBlockhash,
    signers,
    lookupTableInfos,
}) {
    for (let i = 0; i < instructions.length; i++)
        console.log(`Instruction ${i}:`, instructions[i]);

    if (txVersion === TxVersion.LEGACY) {
        const tx = new Transaction();
        tx.add(...instructions);
        tx.feePayer = payer;
        tx.recentBlockhash = recentBlockhash;
        if (signers.length > 0)
            tx.sign(...signers);
        return tx;
    }
    else if (txVersion === TxVersion.V0) {
        const transactionMessage = new TransactionMessage({
            payerKey: payer,
            recentBlockhash,
            instructions,
        });
        const itemV = new VersionedTransaction(transactionMessage.compileToV0Message(lookupTableInfos));
        itemV.sign(signers);
        return itemV;
    }
    else {
        throw Error(' make tx version check error ');
    }
}

exports.buildSimpleTransaction = async ({
    connection,
    makeTxVersion,
    payer,
    innerTransactions,
    recentBlockhash,
    addLookupTableInfo,
}) => {
    if (makeTxVersion !== TxVersion.V0 && makeTxVersion !== TxVersion.LEGACY)
        throw Error(' make tx version args error');
  
    const _recentBlockhash = recentBlockhash ?? (await connection.getLatestBlockhash()).blockhash;
    const txList = [];
    for (const itemIx of innerTransactions) {
        txList.push(
            _makeTransaction({
                txVersion: makeTxVersion,
                instructions: itemIx.instructions,
                payer,
                recentBlockhash: _recentBlockhash,
                signers: itemIx.signers,
                lookupTableInfos: Object.values({
                    ...(addLookupTableInfo ?? {}),
                    ...(itemIx.lookupTableAddress ?? {}),
                }),
            }),
        );
    }
    return txList;
}

exports.sendTransactionList = async (
    connection,
    payer,
    transactions,
    options
) => {
    const txIdList = [];
    for (const tx of transactions) {
        if (tx instanceof VersionedTransaction) {
            tx.sign([payer]);
            txIdList.push(await connection.sendTransaction(tx, options));
        }
        else
            txIdList.push(await connection.sendTransaction(tx, [payer], options));
    }
    return txIdList;
}

exports.buildAndSendTransactionList = async (
    connection,
    makeTxVersion,
    innerTransactions,
    payer,
    options
) => {
    const transactions = await this.buildSimpleTransaction({
        connection,
        makeTxVersion,
        payer: payer.publicKey,
        innerTransactions: innerTransactions,
        addLookupTableInfo: addLookupTableInfo,
    });
    return await this.sendTransactionList(connection, payer, transactions, options);
}

exports.getWalletTokenAccount = async (connection, wallet) => {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });
    return walletTokenAccount.value.map((i) => ({
        pubkey: i.pubkey,
        programId: i.account.owner,
        accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
}

