import ethers from "ethers";
import pkg from '@masa-finance/masa-sdk';
import consoleStamp from 'console-stamp';
import randomWords from "random-words";
import fs from 'fs';
import { config } from "./config.js"

const { Masa, Templates } = pkg;
consoleStamp(console, { format: ':date(HH:MM:ss)' });

const provider = new ethers.providers.JsonRpcProvider(`https://rpc.ankr.com/eth`);
const parseFile = fileName => fs.readFileSync(fileName, "utf8").split('\n').map(str => str.trim()).filter(str => str.length > 1);
const timeout = ms => new Promise(res => setTimeout(res, ms))

let masa;

const isAvailableName = async (soulName) => await masa.contracts.isAvailable(soulName)

function getRandomWord() {
    while (true) {
        let word = randomWords({ exactly: 1, maxLength: config.nameLength.max })[0]

        if (word.length >= config.nameLength.min && word.length <= config.nameLength.max) return word
    }
}

async function getRandomAvailableSoulName() {
    while (true) {
        try {
            let soulName = getRandomWord()
            let isAvailable = await isAvailableName(soulName)

            if (isAvailable) {
                return soulName
            }

            await timeout(100)
        } catch (err) { console.log(`Getting random word error ${err.message}`) }
    }
}

async function purchaseIdentityAndName(args) {
    let tx = await masa.contracts.purchaseIdentityAndName(...args).catch(async (err) => {
        console.log('Mint Error:', err?.reason)
        await timeout(5000)
    })

    if (tx) {
        console.log(tx);
        await tx.wait()
        console.log(`Tx identity and name mint: https://etherscan.io/tx/${tx.hash}`);
        return true
    } else console.log('Не заминтил :(');
}

async function purchaseName(args) {
    let tx = await masa.contracts.purchaseName(...args).catch(async (err) => {
        console.log('Mint error:', err?.reason)
        await timeout(5000)
    })

    if (tx) {
        await tx.wait()
        console.log(`Tx mint name: https://etherscan.io/tx/${tx.hash}`);
        return true
    } else console.log('Не заминтил :(');
}

async function checkNamePrice(name) {
    try {
        let price = await masa.contracts.identity.SoulStoreContract.getPriceForMintingName('0x0000000000000000000000000000000000000000', name.length, config.years)
        return console.log(`Цена минта ${ethers.utils.formatEther(price)} ETH`)
    } catch (err) { console.log(`Check mint price err`); }
}

async function authAndMintSoulName(pk, word = false) {
    let wallet = new ethers.Wallet(pk, provider);
    let balance = await provider.getBalance(wallet.address)
    console.log(`Wallet ${wallet.address}`);
    console.log(`Balance: ${(+ethers.utils.formatEther(balance)).toFixed(6)} ETH`);

    masa = new Masa({
        wallet: wallet,
        apiUrl: "https://middleware.masa.finance",
        environment: "prod",
        network: "mainnet",
        arweave: {
            host: "arweave.net",
            port: 443,
            protocol: "https",
            logging: false
        }
    })

    let attempts = 0;

    while (attempts < 3) {
        try {
            attempts += 1;
            let data = await masa.client.getChallenge()
            let signature = await wallet.signMessage(Templates.loginTemplate(data.challenge, data.expires));
            let login = await masa.client.checkSignature(wallet.address, signature, data.cookie)
            let soulName = word ? word : await getRandomAvailableSoulName();
            let isAvailable = await isAvailableName(soulName)

            if (isAvailable) {
                let soulNameData = await masa.metadata.store(soulName, wallet.address, config.years)

                if (soulNameData) {
                    let attemptsLabel = `attempt ${attempts}`
                    console.log(`Minting soulName: ${soulName} ${attempts > 1 ? attemptsLabel : ''}`);
                    let args = [wallet, 'eth', soulName, soulName.length, 1, `ar://${soulNameData.metadataTransaction.id}`, soulNameData.authorityAddress, soulNameData.signature];
                    await checkNamePrice(soulName)
                    let hasNames = await masa.contracts.getSoulNames(wallet.address)
                    let success = hasNames.length > 0 ? await purchaseName(args) : await purchaseIdentityAndName(args)

                    if (success) return
                }
            } else console.log(`${soulName} уже занято`);
        } catch { error => console.log(`Masa error ${error.message}`) }
    }
}

async function authAndMintSoulNameSingle(pk, wordsArray) {
    let wallet = new ethers.Wallet(pk, provider);
    let balance = await provider.getBalance(wallet.address);
    console.log(`Wallet ${wallet.address}`);
    console.log(`Balance: ${(+ethers.utils.formatEther(balance)).toFixed(6)} ETH`);

    masa = new Masa({
        wallet: wallet,
        apiUrl: "https://middleware.masa.finance",
        environment: "prod",
        network: "mainnet",
        arweave: {
            host: "arweave.net",
            port: 443,
            protocol: "https",
            logging: false
        }
    })


    try {
        let data = await masa.client.getChallenge()
        let signature = await wallet.signMessage(Templates.loginTemplate(data.challenge, data.expires));
        let login = await masa.client.checkSignature(wallet.address, signature, data.cookie)

        for (let i = 0; i < wordsArray.length; i++) {
            let attempts = 0;

            inner: while (attempts < 3) {
                attempts += 1;
                let soulName = wordsArray[i];
                let isAvailable = await isAvailableName(soulName)

                if (isAvailable) {
                    let soulNameData = await masa.metadata.store(soulName, wallet.address, config.years)

                    if (soulNameData) {
                        let attemptsLabel = `attempt ${attempts}`
                        console.log(`Minting soulName: ${soulName} ${attempts > 1 ? attemptsLabel : ''}`);
                        let args = [wallet, 'eth', soulName, soulName.length, 1, `ar://${soulNameData.metadataTransaction.id}`, soulNameData.authorityAddress, soulNameData.signature];

                        let hasNames = await masa.contracts.getSoulNames(wallet.address)
                        let success = hasNames.length > 0 ? await purchaseName(args) : await purchaseIdentityAndName(args)

                        if (success) break inner
                    }
                } else { console.log(`${soulName} уже занято`); break inner }
            }
            console.log('-'.repeat(80));
        }

        return
    } catch { error => console.log(`Masa error ${error.message}`) }

}

(async () => {
    let privateKeys = parseFile('privateKeys.txt');
    let words = parseFile('words.txt');
    console.log(`Загружено ${privateKeys.length} кошельков и ${words.length} доменов`);

    if (privateKeys.length > 1) {
        if (words.length > 0) {
            console.log('Режим: 1 кошелек - 1 указанное слово');
            for (let i = 0; i < privateKeys.length; i++) {
                await authAndMintSoulName(privateKeys[i], words[i]);
                console.log('-'.repeat(80));
            }
        } else {
            console.log('Режим: 1 кошелек - 1 случайное слово');
            for (let i = 0; i < privateKeys.length; i++) {
                await authAndMintSoulName(privateKeys[i]);
                console.log('-'.repeat(80));
            }
        }
    } else if (privateKeys.length === 1 && words.length >= 1) {
        console.log('Режим минта всех доменов на 1 кошелек');
        await authAndMintSoulNameSingle(privateKeys[0], words);
    }
})()