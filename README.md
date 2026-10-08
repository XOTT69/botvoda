# Чабани — вода + світло

Telegram-бот для Чабанів: приймає переслані текстові графіки `єСвітло`, стежить за групою насосної **1.2** і домашньою групою **2.2**, рахує години води та спільні вікна вода+світло.

## Логіка води

- якщо група 1.2 зі світлом — вода є;
- коли 1.2 відключена, діє резервний графік водопостачання: **06:00–10:00, 12:00–14:00, 18:00–24:00**;
- бот також приймає переслане текстове повідомлення з новим графіком води й замінює резервні інтервали.

## Підтримувані повідомлення

- повний графік `єСвітло` на сьогодні/завтра;
- `❗️ Зміни у графіку` з блоками `Було:` / `Стало:` — береться тільки `Стало:`;
- часткові зміни не стирають незмінені групи.

## Cloudflare Workers + D1

1. Створи D1: `npx wrangler d1 create chabany-water-bot-db`.
2. Встав `database_id` у `wrangler.jsonc` замість `PASTE_D1_DATABASE_ID_HERE`.
3. Застосуй БД: `npx wrangler d1 migrations apply DB --remote`.
4. Додай secrets `TELEGRAM_BOT_TOKEN` і `TELEGRAM_WEBHOOK_SECRET`.
5. Deploy: `npx wrangler deploy`.
6. Telegram webhook має вести на `https://<worker>/telegram` і використовувати той самий `secret_token`.

Cron Trigger уже заданий: кожні 5 хвилин.

## Git integration у Cloudflare

Підключай цей GitHub-репозиторій до Workers Builds. Корінь проєкту `/`. Build command можна лишити `npm install`, deploy command — `npx wrangler deploy`.

## Тести

`npm test`
