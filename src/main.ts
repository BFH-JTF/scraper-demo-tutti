import {writeFileSync} from 'fs';
import {join} from 'path';
import path from 'path';
import { fileURLToPath } from 'url';
import { json2csv } from 'json-2-csv';
import {Page} from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha'
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
puppeteer.use(RecaptchaPlugin()).use(StealthPlugin()).use(AdblockerPlugin())
const MAX_PAGE_SCAN = 4;

const userAgentStrings = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.2227.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.3497.92 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
];
const webSiteURL = 'https://www.tutti.ch';


(async () => {
    const browser = await puppeteer.launch({headless: false, args: ["--start-maximized"]});
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': userAgentStrings[Math.floor(Math.random() * userAgentStrings.length)] });
    await page.goto(webSiteURL);
    console.log("Main Site loaded")
    await checkAcceptButton(page);

    // Category selection
    let links = await page.$$eval('a[href*=\'autos\']', (links) => {
        return links.map(link => ({ href: link.href, text: link.innerText }));
    });

    links = links.filter(link => link.text.includes('Autos'));

    if (links.length !== 1)
        console.log("No unique category link found");
    else {
        let catLink = links[0].href;
        console.log(`Choosing category: ${catLink}`)
        await page.goto(catLink);
        await page.waitForSelector('button[aria-label^="Go to next page"]')
        await checkAcceptButton(page);
        let foundLinks: string[] = [];
        let adLinks: string[] = [];
        for (let n = 0; n < MAX_PAGE_SCAN; n++) {
            await checkAcceptButton(page);
            foundLinks = await scanPage(page, n);
            console.log(foundLinks)
            adLinks = [...adLinks, ...foundLinks];
            await page.waitForSelector('button[aria-label^="Go to next page"]')
            const nextPageButton = await page.$('button[aria-label^="Go to next page"]');
            if (nextPageButton === null) {
                console.log("Could not find button for next page")
                break;
            }
            else
                await nextPageButton.click();
        }
        let entries = await scrapePages(page, foundLinks);
        if (entries && entries.length > 0) {
            //console.log(entries);
            let csv = json2csv(entries,{delimiter: {field: ";"}});
            writeFileSync(join(__dirname, "autos.csv"), csv, {
                flag: 'w',
            });
        }
    }
    await browser.close();
})();


async function scrapePages(page: Page, adLinks: string[]) {
    let entryArray:adDataCar[] = [];
    for (let link of adLinks) {
        let today = new Date();
        let newEntry:adDataCar = {
            author: "",
            link: webSiteURL + link,
            title: "",
            description: "",
            initRegistrationYear: 0,
            kilometers: 0,
            price: parseNumberString("0.-"),
            timestamp: today.getTime()/1000,
            model: "",
            manufacturer: "",
            zip: 0,
            gearbox: "",
            power: 0,
            fuel: "",
            doors: 0,
            color: ""
        }

        await page.goto(newEntry.link);
        let contentBox = await page.$(".content");
        if (contentBox === null)
            return null;

        // Elements of interest
        try {
            let descriptionDiv = await page.$("div.mui-style-1cs9ojo");
            if (descriptionDiv !== null){
                let descriptionSpan = await descriptionDiv.$("span");
                if (descriptionSpan !== null)
                    newEntry.description = await descriptionSpan.evaluate(el => el.innerText);
            }
            let tableRows = await page.$$(".mui-style-vlvrlo");
            for (let row of tableRows) {
                let contentSpans = await row.$$("span");
                if (contentSpans.length !== 2){
                    console.log(`Inconsistent number of contentSpans: ${contentSpans.length}`);
                    break;
                }
                else {
                    let label = await contentSpans[0].evaluate(el => el.innerText);
                    let value = await contentSpans[1].evaluate(el => el.innerText);
                    switch (label) {
                        case "Preis CHF":
                            newEntry.price = parseNumberString(value);
                            break;
                        case "Erstzulassung":
                            newEntry.initRegistrationYear = parseNumberString(value);
                            break;
                        case "Kilometerstand":
                            newEntry.kilometers = parseNumberString(value);
                            break;
                        case "PLZ":
                            newEntry.zip = parseNumberString(value);
                            break;
                        case "Marke":
                            newEntry.manufacturer = value;
                            break;
                        case "Türen":
                            newEntry.doors = parseNumberString(value);
                            break;
                        case "Farbe":
                            newEntry.color = value;
                            break;
                        case "Treibstoff":
                            newEntry.fuel = value;
                            break;
                        case "Getriebeart":
                            newEntry.gearbox = value;
                            break;
                        case "Leistung":
                            newEntry.power = parseNumberString(value);
                            break;
                        case "Modell":
                            newEntry.model = value;
                            break;
                        case "Aufbau":
                            break;
                        default:
                            console.log(`Unknown content label ${label}`);
                            break;
                    }
                }
            }
            let h5Elements = await contentBox.$$(".MuiTypography-h5");
            for (let element of h5Elements) {
                let elementString = await element.evaluate(el => el.innerHTML);
                if (Number.isNaN(Number(elementString[0])))
                    newEntry.title = elementString;
                else
                    newEntry.price = parseNumberString(elementString);
            }

            let h6Elements = await contentBox.$$(".MuiTypography-h6");
            for (let element of h6Elements) {
                let elementString = await element.evaluate(el => el.innerHTML);
                if (elementString.localeCompare("Ähnliche Inserate") !== 0)
                    newEntry.author = elementString;
            }
            entryArray.push(newEntry);
        }
        catch (e) {
            console.log("Error finding elements of interest!")
            console.log(await contentBox.evaluate(el => el.innerHTML))
        }
    }
    return entryArray;
}

async function scanPage(page: Page, pageIndex: number) {
    let linkCollection:string[] = [];
    let autoLinks = await page.$$("a[href*='fahrzeuge/autos']")
    if (autoLinks.length === 0) {
        console.log("Could not find ad page links")
        console.log(page);
        return [];
    }
    console.log("Scanning page", pageIndex+1);
    for (let link of autoLinks){
        let linkString = await link.evaluate( (el: { getAttribute: (arg0: string) => any; }) => el.getAttribute("href") );
        console.log(`New article link found on this page): ${webSiteURL + linkString}`);
        if (!linkCollection.includes(linkString))
            linkCollection.push(linkString);
    }
    return linkCollection;
}

function parseNumberString(priceStr: string) {
    const cleanedStr = priceStr.replace(/[^0-9.-]+/g, '');
    const priceNum = parseFloat(cleanedStr);
    if (isNaN(priceNum))
        throw new Error(`Invalid number format: ${priceStr}`);
    return priceNum;
}

interface adDataCar {
    link: string,
    author: string,
    title: string,
    description: string,
    timestamp: number,
    price: number,
    kilometers: number,
    initRegistrationYear: number,
    model: string,
    manufacturer: string,
    zip: number,
    gearbox: string,
    power: number,
    fuel: string,
    doors: number,
    color: string
}

async function checkAcceptButton(page: Page){
    console.log("Checking for accept button")
    page.$('#onetrust-accept-btn-handler').then(async acceptButton => {
        if (acceptButton !== null) {
            await acceptButton.click();
                console.log("Confirmed website conditions")
        }
        else
            console.log("No user acceptance requested")
    })
}