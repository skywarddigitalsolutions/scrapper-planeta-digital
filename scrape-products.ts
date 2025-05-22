import puppeteer, { Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import readline from 'readline';

const ESTADO_FILE = path.resolve(__dirname, 'estado.json');
const OUTPUT_FILE = path.resolve(__dirname, 'productos.json');
const ERRORS_FILE = path.resolve(__dirname, 'errores.json');
const IMAGES_DIR = path.resolve(__dirname, 'images');

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // quita tildes
    .replace(/[()]/g, '')               // elimina paréntesis
    .replace(/[^a-z0-9]/gi, '_')        // no alfanumérico → "_"
    .replace(/_+/g, '_')                // múltiples "_" seguidos → uno solo
    .slice(0, 100);
}

async function downloadImage(url: string, filename: string): Promise<string> {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const filePath = path.join(IMAGES_DIR, filename);
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  await fs.writeFile(filePath, response.data);
  return `./images/${filename}`;
}

async function readLastIndex(): Promise<number> {
  try {
    const data = await fs.readFile(ESTADO_FILE, 'utf-8');
    return JSON.parse(data).lastIndex || 0;
  } catch {
    return 0;
  }
}

async function saveLastIndex(index: number): Promise<void> {
  await fs.writeFile(ESTADO_FILE, JSON.stringify({ lastIndex: index }, null, 2));
}

async function loadExistingProducts(): Promise<any[]> {
  try {
    const data = await fs.readFile(OUTPUT_FILE, 'utf-8');
    return JSON.parse(data).products || [];
  } catch {
    return [];
  }
}

async function saveProducts(products: any[]): Promise<void> {
  const data = { total: products.length, products };
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function loadErrorIndexes(): Promise<number[]> {
  try {
    const data = await fs.readFile(ERRORS_FILE, 'utf-8');
    return JSON.parse(data).errors || [];
  } catch {
    return [];
  }
}

async function saveErrorIndexes(indexes: number[]): Promise<void> {
  await fs.writeFile(ERRORS_FILE, JSON.stringify({ errors: indexes }, null, 2), 'utf-8');
}

// readline helper
type Answer = string;
function ask(question: string): Promise<Answer> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// scroll helper
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalHeight = 0;
      const distance = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

async function scrapeAllProducts() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Load list and scroll to load all
  await page.goto('https://herramientas-mayorista.catalog.kyte.site/', { waitUntil: 'networkidle2' });
  await scrollToBottom(page);

  const selector = 'div.product_list-product__kuvj5';
  const total = await page.$$eval(selector, els => els.length);
  let startIndex = await readLastIndex();
  const scraped = await loadExistingProducts();
  const errors = await loadErrorIndexes();

  // decide mode if there are error indexes
  let retryErrors = false;
  if (errors.length > 0) {
    const ans = await ask(`Se encontraron índices con error: [${errors.join(', ')}].\n¿Reintentar solo esos? (y/n): `);
    retryErrors = ans.trim().toLowerCase().startsWith('y');
  }

  // helper to process a single index
  async function processIndex(idx: number) {
    const items = await page.$$(selector);
    const card = items[idx];
    if (!card) throw new Error(`No product card at index ${idx}`);

    // extract summary info from list (fields default to empty string)
    const summary = await card.evaluate(node => ({
      name: node.querySelector('h4.product_title__t7dLU')?.textContent?.trim() || '',
      category: node.querySelector('small.product_category__MfZs_')?.textContent?.trim() || '',
      price: node.querySelector('strong.product_price__hgX1S')?.textContent?.trim() || '',
      description: node.querySelector('div.product_description__C_5ER')?.textContent?.trim() || '',
      mainImage: node.querySelector('div.product_image-wrapper__wHSJ6 img')?.getAttribute('src') || ''
    }));

    // Detail page
    await card.evaluate(node => {
      const img = node.querySelector('div.product_image-wrapper__wHSJ6 img');
      if (!img) throw new Error('No clickable image');
      (img as HTMLElement).click();
    });

    // Esperar detalle cargado
    await page.waitForSelector('div.container_container__2BL3U', { timeout: 5000 });

    // extract extra images
    const extraImages: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img.slick-custom_side-images-image__RDT3o'))
        .map(img => img.getAttribute('src') || '')
        .filter(src => src.startsWith('http'))
    );

    // download images
    const base = sanitizeFilename(summary.name);
    const imgMain = summary.mainImage ? await downloadImage(summary.mainImage, `${base}.jpg`) : '';
    const extras: string[] = [];
    for (let j = 0; j < extraImages.length; j++) {
      const url = extraImages[j];
      const file = `${base}_${j + 1}.jpg`;
      extras.push(await downloadImage(url, file));
    }

    scraped.push({
      name: summary.name,
      category: summary.category,
      price: summary.price,
      description: summary.description,
      image: imgMain,
      images: extras,
    });
    await saveProducts(scraped);
  }

  if (retryErrors) {
    // only retry the error indexes
    for (const idx of errors) {
      try {
        await processIndex(idx);
        console.log(`✅ Reintentando índice ${idx}`);
      } catch (e) {
        console.error(`❌ Falló de nuevo índice ${idx}:`, e);
      }
    }
  } else {
    // normal full scrape from lastIndex
    for (let index = startIndex; index < total; index++) {
      try {
        await processIndex(index);
        await saveLastIndex(index + 1);
        console.log(`✅ Producto ${index + 1}/${total}`);
      } catch (e) {
        console.error(`❌ Error en index ${index}:`, e);
        errors.push(index);
        await saveErrorIndexes(errors);
        await saveLastIndex(index);
      }

      // navigate back
      try {
        await page.click('div.navigate-back_navigate-back__7_Ydu');
        await page.waitForSelector(selector, { timeout: 5000 });
      } catch {
        console.warn('⚠️ Volver no encontrado, recargando listado');
        await page.goto('https://herramientas-mayorista.catalog.kyte.site/', { waitUntil: 'networkidle2' });
        await scrollToBottom(page);
      }
    }
  }

  await browser.close();
  console.log(`📝 Guardados ${scraped.length} productos. Errores índices: [${errors.join(', ')}]`);
}

scrapeAllProducts().catch(console.error);
