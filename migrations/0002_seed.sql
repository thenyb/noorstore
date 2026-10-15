-- 0002_seed.sql — deterministic workshop seed for NoorStore.
--
-- Seeds: 8 products, one victim customer (id=1), and two victim orders with
-- EXPLICIT ids 581 and 582 so the "change /orders/581/ to /orders/582/"
-- attack always has a target. New checkouts continue from 583+.
--
-- SECURITY NOTE: this file intentionally contains NO flag. The sensitive
-- order note for order 582 is injected at runtime by the Worker from the
-- FLAG secret (see ensureOrderFlag() in src/index.ts). Never commit a flag here.

-- Products (prices in halala = SAR * 100).
INSERT OR IGNORE INTO products (id, name_en, name_ar, description, price_cents, stock, emoji) VALUES
(1, 'Wireless Headphones', 'سماعة رأس لاسلكية', 'Bluetooth 5.3, noise cancelling, 40h battery.', 34900, 60, '🎧'),
(2, 'Smartphone X2', 'هاتف ذكي X2', '128GB, 50MP camera, 2-year warranty.', 129900, 40, '📱'),
(3, 'Laptop Pro 14', 'لابتوب برو 14', '14-inch, 16GB RAM, 512GB SSD, Arabic/English keyboard.', 289900, 25, '💻'),
(4, 'Coffee Maker', 'ماكينة قهوة', '15-bar pump, Arabic coffee + espresso modes.', 45900, 50, '☕'),
(5, 'Smartwatch S', 'ساعة ذكية S', 'Heart-rate + sleep tracking, 10-day battery.', 79900, 70, '⌚'),
(6, 'Travel Backpack', 'حقيبة ظهر للسفر', '35L, water resistant, laptop sleeve.', 18900, 90, '🎒'),
(7, 'Oud Perfume 100ml', 'عطر عود 100مل', 'Premium Arabian oud, gift box included.', 25900, 80, '🌸'),
(8, 'Desk Lamp', 'مصباح مكتب', 'LED, warm/cool modes, USB-C powered.', 12900, 120, '💡');

-- Victim customer (id=1). Password is a strong undisclosed value; only its
-- PBKDF2-SHA256 hash (120000 iterations) is stored. Login as this user is not
-- part of the workshop — reach their orders via the IDOR instead.
INSERT OR IGNORE INTO users (id, name, email, password_hash, salt, created_at) VALUES
(1, 'Layla Hassan', 'layla@example.com',
 '11b201716e471b2fa3ddb0702a0c840b710d778a70aeee773be9feffc94bade4',
 'e3aea0652e1c595fcc53e766e2597db8',
 '2026-01-10T09:00:00.000Z');

-- Victim order 581: ordinary order, no sensitive data.
INSERT OR IGNORE INTO orders (id, user_id, status, total_cents, address, phone, gift_note, created_at) VALUES
(581, 1, 'delivered', 105800, 'Jeddah, Al Hamra district, King Fahd Rd, Bldg 12', '+966501112233',
 'Please gift-wrap the perfume box. — Layla',
 '2026-09-02T14:20:00.000Z');
INSERT OR IGNORE INTO order_items (id, order_id, product_id, qty, unit_price_cents) VALUES
(1001, 581, 5, 1, 79900),
(1002, 581, 7, 1, 25900);

-- Victim order 582: the TARGET. gift_note stays NULL here on purpose —
-- the Worker fills it at runtime from the FLAG secret (never in this file).
INSERT OR IGNORE INTO orders (id, user_id, status, total_cents, address, phone, gift_note, created_at) VALUES
(582, 1, 'paid', 324800, 'Riyadh, Al Olaya, Prince Mohammed Bin Salman Rd, Tower B, Apt 1402', '+966504445566',
 NULL,
 '2026-10-01T11:05:00.000Z');
INSERT OR IGNORE INTO order_items (id, order_id, product_id, qty, unit_price_cents) VALUES
(1003, 582, 3, 1, 289900),
(1004, 582, 1, 1, 34900);

-- Keep AUTOINCREMENT continuing after the explicit ids.
UPDATE sqlite_sequence SET seq = 582 WHERE name = 'orders';
UPDATE sqlite_sequence SET seq = 1004 WHERE name = 'order_items';
