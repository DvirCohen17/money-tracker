# MoneyTracker v1.4.0

## מה חדש
- Heatmap שנתי עם אריחים גדולים יותר; Heatmap חודשי ירוק/אדום לפי תקציב, לחיצה על יום פותחת את ההוצאות, התקציב היומי ואחוז הניצול.
- הוצאות קבועות/מנויים עם בחירת שירות וחבילה, קטלוג מחירים ומקור; רענון קטלוג בתחילת חודש.
- הגדרות נקיות: נעילה נמצאת רק תחת אבטחה, והתקנה נמצאת רק תחת אפליקציה והתקנה.
- פרופיל מציג רק את החשבון המחובר ואת אנשי החשבון המשותף, בלי רשימת משתמשי DB.
- אפשר לערוך פרטי חשבון, להוסיף/לערוך/למחוק אנשים בחשבון משותף, ולהתנתק/להתחבר לחשבון אחר.
- שרת עם JWT, SQLite WAL, שמירה אוטומטית, household משותף וסנכרון polling בין מכשירים.

## שרת
השרת נמצא בתיקיית `server/`. ב-Render מוגדר persistent disk דרך `render.yaml`, ולכן SQLite נשמר גם אחרי redeploy. הקוד לא מפרסם endpoint שמחזיר את כל המשתמשים; כל קריאה מאומתת קשורה ל-household של המשתמש המחובר.

## משתני סביבה
- `JWT_SECRET` — חובה להחליף לערך סודי בפריסה אמיתית.
- `DB_PATH` — נתיב ל-SQLite; ב-Render הוא מצביע לדיסק המתמיד.
- `PORT` — נקבע אוטומטית על ידי הפלטפורמה.

## Frontend
אם ה-API וה-frontend באותו host, אין צורך להגדיר `MONEYTRACKER_API_URL`. אם הם נפרדים, הגדירו אותו ב-`config.js`.

## v1.5.0 — Local AI category engine

MoneyTracker now includes an optional multilingual local AI classifier for automatic transaction categories.

- Uses Transformers.js in a Web Worker.
- Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
- The model is downloaded from Hugging Face on first use (or manually from Settings) and cached in the browser.
- Transaction descriptions are embedded/classified locally after the model is downloaded; they are not sent to an AI API.
- The classifier supports Hebrew and English and combines semantic similarity with the existing fast local keyword fallback.
- Manually selected categories are stored as local examples so the classifier can learn the user's preferences.
- The app continues to work without a server; only the initial model download requires internet access.

The model is relatively large, so the first download may take time and storage. Subsequent use is local and uses the browser cache.
