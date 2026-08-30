# MoneyTracker backend

שרת Node/Express עם SQLite ו-JWT. אותו שירות יכול להגיש גם את קבצי האפליקציה.

## הרצה מקומית
1. `cd server`
2. `npm install`
3. הגדירו `JWT_SECRET` לערך אקראי ארוך
4. `npm start`

פתחו את כתובת השרת (למשל `http://localhost:3000`).

## API
- `POST /api/register`
- `POST /api/login`
- `GET /api/me`
- `GET /api/state`
- `PUT /api/state`
- `GET /api/health`

## פריסה
אפשר לחבר את מאגר ה-Git לשירות Node כמו Render / Railway / Fly.io. כל push ל-Git יכול להפעיל deploy אוטומטי.

SQLite מתאים לאב-טיפוס או לשרת עם דיסק persistent. לפרויקט רב-משתמשים רציני עדיף לעבור ל-PostgreSQL מנוהל.

יש להפעיל HTTPS, secret חזק, rate limiting, גיבויים, ו-CORS מוגבל לדומיין האפליקציה.
