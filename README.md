# Tiegram Messenger

Веб-мессенджер с авторизацией через Telegram-бота.

## Запуск локально

1. Установите зависимости:
   ```
   npm install
   ```
2. Создайте `.env` файл:
   ```
   BOT_TOKEN=ваш_токен
   PORT=3000
   ```
3. Запустите:
   ```
   npm start
   ```

## Деплой на bothost.ru

1. Залейте проект на GitHub
2. На bothost.ru: New Project → Node.js → подключите репо
3. В переменных окружения добавьте `BOT_TOKEN`
4. Deploy!

Бот: создайте через @BotFather в Telegram, токен вставьте в BOT_TOKEN.
