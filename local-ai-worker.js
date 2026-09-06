/* MoneyTracker Local AI worker
 * Runs multilingual sentence embeddings entirely in the browser worker.
 * No user text is sent to a remote AI service. The model files are downloaded
 * from Hugging Face on first use and cached by Transformers.js.
 */

let extractorPromise = null;
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const MODEL_REVISION = '2c4055b';
const EMBEDDING_CACHE = new Map();
const EMBEDDING_CACHE_MAX = 160;

function normalizeText(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/[׳']/g, "'").replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
}

const EXTRA_PROTOTYPES = {
  'אוכל ומזון': ['ארוחת צהריים ארוחת ערב ארוחת בוקר משלוח וולט תן ביס קפה מאפה קינוח גלידה', 'mcdonalds burger king domino pizza hut takeaway lunch dinner breakfast coffee pastry dessert grocery supermarket', 'שופרסל רמי לוי ויקטורי קרפור סופר פארם אוכל מכולת מעדניה'],
  'מגורים וחשבונות': ['שכר דירה דירה שכירות ועד בית חשבון חשמל חשבון מים חשבון גז חשבון אינטרנט סלולר', 'rent apartment utilities electricity water gas internet mobile phone bill', 'ארנונה ביטוח דירה תחזוקת בית תיקון לבית'],
  'תחבורה': ['תחנת דלק תדלוק דלקן פז סונול דור אלון חניה חניון דוח חניה', 'gas station fuel parking public transport bus train taxi uber gett', 'טסט טיפול לרכב תיקון רכב מוסך צמיגים כביש אגרה רב קו'],
  'פנאי ובילויים': ['נטפליקס ספוטיפיי דיסני פלייסטיישן אקסבוקס סטים משחק מחשב', 'streaming cinema movie concert party bar club vacation attraction', 'חופשה מלון בילוי הופעה פסטיבל כרטיס להופעה ספורט'],
  'קניות': ['קניתי בגדים חולצה מכנס נעליים מתנה מוצר לבית ריהוט', 'shopping clothes shoes electronics furniture amazon ikea zara', 'אוזניות טלפון מחשב מסך מטען כלי בית'],
  'השקעות': ['הפקדה לתיק השקעות קניתי מניה קרן סל קריפטו ברוקר', 'investment portfolio stock etf bond brokerage trading commission', 'מניה מניות אגח קרן נאמנות מסחר בבורסה עמלה'],
  'עבודה/פרילנס': ['ציוד למשרד תוכנה לעבודה הוצאה עסקית חשבונית עסק', 'office supplies business expense freelance client software subscription', 'עבודה פרילנס עסק משרד לקוח מקצועי'],
  'שונות': ['תשלום אחר הוצאה כללית עמלה קנס תרומה', 'miscellaneous general payment fee fine donation other expense']
};


const BASE_PROTOTYPES = {
  'אוכל ומזון': [
    'מסעדה אוכל ארוחה המבורגר פיצה סושי שווארמה פלאפל קפה מאפייה מכולת סופרמרקט משלוח אוכל',
    'restaurant food meal burger pizza sushi shawarma falafel cafe bakery grocery supermarket food delivery'
  ],
  'מגורים וחשבונות': [
    'שכר דירה ארנונה חשמל מים גז אינטרנט טלפון ביטוח ועד בית חשבונות לבית',
    'rent electricity water gas internet phone insurance home bills utilities'
  ],
  'תחבורה': [
    'דלק תחנת דלק מונית אוטובוס רכבת חניה כביש אגרה מוסך שטיפת רכב רכב',
    'fuel gas station taxi bus train parking toll road garage car wash transportation'
  ],
  'פנאי ובילויים': [
    'קולנוע סרט הופעה קונצרט בר מועדון משחק אטרקציה פארק מים ספורט בילוי נטפליקס ספוטיפיי',
    'cinema movie concert bar club game attraction water park sports entertainment netflix spotify'
  ],
  'קניות': [
    'בגדים נעליים אלקטרוניקה מחשב טלפון ריהוט איקאה אמזון זארה קניות',
    'clothes shoes electronics computer phone furniture ikea amazon zara shopping'
  ],
  'השקעות': [
    'השקעה מניה מניות בורסה קרן סל אגח מסחר ברוקר תיק השקעות',
    'investment stock stocks exchange ETF bond trading broker portfolio'
  ],
  'עבודה/פרילנס': [
    'עבודה משרד פרילנס עסק ציוד משרדי הוצאות עסקיות',
    'work office freelance business office supplies business expense'
  ],
  'שונות': [
    'הוצאה אחרת תשלום כללי משהו אחר',
    'other expense general payment miscellaneous'
  ]
};

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      post('loading', { stage: 'library' });
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;

      const device = self.navigator?.gpu ? 'webgpu' : 'wasm';
      return pipeline('feature-extraction', MODEL_ID, {
        revision: MODEL_REVISION,
        device,
        dtype: device === 'webgpu' ? 'fp16' : 'q8',
        progress_callback: info => {
          if (info?.status === 'progress_total') {
            post('progress', { progress: Math.max(0, Math.min(100, Number(info.progress) || 0)), file: info.file || '' });
          } else if (info?.status === 'ready') {
            post('ready', { model: MODEL_ID, device });
          }
        }
      });
    })().catch(err => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

function toArray(tensor) {
  if (!tensor) return [];
  if (typeof tensor.tolist === 'function') return tensor.tolist();
  return Array.from(tensor.data || tensor);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embed(texts) {
  const clean = texts.map(normalizeText);
  const result = new Array(clean.length);
  const missing = [];
  const missingKeys = [];
  clean.forEach((text, i) => {
    const cached = EMBEDDING_CACHE.get(text);
    if (cached) result[i] = cached;
    else { missing.push(text); missingKeys.push(text); }
  });
  if (missing.length) {
    const extractor = await getExtractor();
    const out = await extractor(missing, { pooling: 'mean', normalize: true });
    const rows = toArray(out);
    let vectors;
    if (Array.isArray(rows[0])) vectors = rows;
    else {
      const dim = 384; vectors = [];
      for (let i = 0; i < rows.length; i += dim) vectors.push(rows.slice(i, i + dim));
    }
    missingKeys.forEach((key, i) => {
      EMBEDDING_CACHE.set(key, vectors[i]);
      while (EMBEDDING_CACHE.size > EMBEDDING_CACHE_MAX) EMBEDDING_CACHE.delete(EMBEDDING_CACHE.keys().next().value);
    });
    clean.forEach((text, i) => { if (!result[i]) result[i] = EMBEDDING_CACHE.get(text); });
  }
  return result;
}

self.onmessage = async (event) => {
  const { id, action } = event.data || {};
  try {
    if (action === 'load') {
      await getExtractor();
      post('result', { id, result: { ready: true, model: MODEL_ID } });
      return;
    }
    if (action === 'embed') {
      const embeddings = await embed(Array.isArray(event.data.texts) ? event.data.texts : [String(event.data.texts || '')]);
      post('result', { id, result: { embeddings } });
      return;
    }
    if (action === 'classify') {
      const description = String(event.data.description || '').trim();
      const examples = event.data.examples || {};
      const labels = Object.keys(BASE_PROTOTYPES);
      const texts = [description];
      const prototypeIndexes = {};
      for (const label of labels) {
        prototypeIndexes[label] = [];
        for (const text of [...(BASE_PROTOTYPES[label] || []), ...(EXTRA_PROTOTYPES[label] || [])]) { prototypeIndexes[label].push(texts.length); texts.push(text); }
        for (const text of Array.isArray(examples[label]) ? examples[label].slice(-20) : []) { prototypeIndexes[label].push(texts.length); texts.push(text); }
      }
      const vectors = await embed(texts);
      const query = vectors[0];
      const scores = labels.map(label => {
        const idxs = prototypeIndexes[label];
        const sims = idxs.map(i => cosine(query, vectors[i]));
        sims.sort((a,b) => b-a);
        const base = sims[0] || 0;
        const second = sims[1] || base;
        // Best match + small support from a second close example.
        const third = sims[2] || second;
        const score = base * 0.62 + second * 0.23 + third * 0.15;
        return { label, score };
      }).sort((a,b) => b.score - a.score);
      const best = scores[0] || { label: 'שונות', score: 0 };
      const second = scores[1] || { score: 0 };
      // Convert cosine similarity into a conservative confidence estimate.
      const margin = best.score - second.score;
      const confidence = Math.max(0, Math.min(1, 0.45 + margin * 3.0 + Math.max(0, best.score - 0.48) * 0.8));
      post('result', { id, result: { category: best.label, score: best.score, confidence, ranked: scores } });
      return;
    }
    post('result', { id, result: null });
  } catch (error) {
    post('error', { id, error: String(error?.message || error) });
  }
};
