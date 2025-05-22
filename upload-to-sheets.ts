import { readFile } from 'fs/promises';
import * as path from 'path';
import { google } from 'googleapis';

// --- Configuración ---
const SPREADSHEET_ID = '1PeMm883Ad99X9X8OTlSwitcgM0laSmAihtyLPtGXNvY';
const SHEET_NAME     = 'Productos';
const CRED_PATH      = path.resolve(__dirname, 'planeta-digital-460621-6ff0f49282c6.json');

async function main() {
  // 1) Cargar credenciales de la cuenta de servicio
  const auth = new google.auth.GoogleAuth({
    keyFile: CRED_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 2) Leer y parsear productos.json
  const raw = await readFile(path.resolve(__dirname, 'productos.json'), 'utf-8');
  const { products } = JSON.parse(raw) as {
    total: number;
    products: {
      name: string;
      category: string;
      price: string;
      description: string;
      image: string;     // aquí debe ser la URL pública de la imagen principal
      images: string[];
    }[];
  };

  // 3) Construir filas, poniendo la imagen primero con =IMAGE(...)
  const rows = [
    ['Imagen principal','Nombre','Categoría','Precio','Descripción','Imágenes extra'],
    ...products.map(p => [
      // la función IMAGE mostrará la imagen directamente en la celda
      p.image ? `=IMAGE("${p.image}")` : '',
      p.name,
      p.category,
      p.price,
      p.description.replace(/\n/g, ' '),
      p.images.join(', ')
    ])
  ];

  // 4) Escribir todo de una vez en A1
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',  // USER_ENTERED para que =IMAGE() se interprete
    requestBody: { values: rows }
  });

  console.log(`✅ Volcados ${products.length} productos en ${SHEET_NAME}!`);
}


main().catch(err => {
  console.error(err);
  process.exit(1);
});
