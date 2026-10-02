-- ПРОВЕРКА ЦЕЛОСТНОСТИ ДАННЫХ ДЕПОЗИТОВ И ВЫВОДОВ

-- 1. Проверка: все ли deposited средства есть в балансе пользователей
SELECT 
    COALESCE(SUM(d.amount_usd), 0) as total_deposits,
    COALESCE(SUM(u.balance), 0) as total_balance,
    COALESCE(SUM(u.referral_balance), 0) as total_ref_balance
FROM deposits d
RIGHT JOIN users u ON 1=1
WHERE d.status = 'confirmed';

-- 2. Проверка на дублирование депозитов (если есть - это проблема!)
SELECT 
    invoice_id, 
    order_id, 
    guid, 
    COUNT(*) as count,
    SUM(amount_usd) as total_amount
FROM deposits
WHERE status = 'confirmed'
GROUP BY COALESCE(invoice_id, ''), COALESCE(order_id, ''), COALESCE(guid, '')
HAVING COUNT(*) > 1;

-- 3. Проверка на pending депозиты старше 1 часа
SELECT 
    deposit_id,
    user_id,
    amount_usd,
    payment_system,
    datetime(timestamp, 'unixepoch') as created_at,
    datetime('now') as now
FROM deposits
WHERE status = 'pending' 
  AND timestamp < (strftime('%s', 'now') - 3600);  -- Старше 1 часа

-- 4. Проверка на выводы без соответствующего уменьшения баланса
SELECT 
    w.withdrawal_id,
    w.user_id,
    w.amount,
    u.balance as current_balance
FROM withdrawals w
LEFT JOIN users u ON w.user_id = u.user_id
WHERE w.status = 'completed'
ORDER BY w.timestamp DESC
LIMIT 20;

-- 5. Проверка баланса каждого пользователя (доверить только этой таблице)
SELECT 
    user_id,
    ROUND(balance, 2) as main_balance,
    ROUND(referral_balance, 2) as ref_balance,
    ROUND(balance + referral_balance, 2) as total_balance,
    registration_date
FROM users
WHERE balance > 0 OR referral_balance > 0
ORDER BY (balance + referral_balance) DESC
LIMIT 20;

-- 6. Проверка на незапись withdrawal правильно
SELECT 
    COUNT(*) as total_confirmed_deposits,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_deposits,
    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_deposits
FROM deposits;

-- 7. Проверка: пользователь имеет баланс больше суммы его депозитов (может быть признаком проблемы)
SELECT 
    u.user_id,
    u.username,
    ROUND(u.balance, 2) as balance,
    ROUND(COALESCE(SUM(d.amount_usd), 0), 2) as total_deposits,
    ROUND(COALESCE(SUM(w.amount), 0), 2) as total_withdrawals
FROM users u
LEFT JOIN deposits d ON u.user_id = d.user_id AND d.status = 'confirmed'
LEFT JOIN withdrawals w ON u.user_id = w.user_id
GROUP BY u.user_id
HAVING u.balance > COALESCE(SUM(d.amount_usd), 0)
  OR u.balance < 0;  -- Отрицательный баланс это точно проблема!

-- 8. Статистика по платежным системам
SELECT 
    payment_system,
    COUNT(*) as total_deposits,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
    ROUND(SUM(CASE WHEN status = 'confirmed' THEN amount_usd ELSE 0 END), 2) as confirmed_amount
FROM deposits
GROUP BY payment_system;

-- 9. Проверка целостности: баланс == (deposited - withdrawn)
SELECT 
    u.user_id,
    u.username,
    ROUND(u.balance, 2) as db_balance,
    ROUND(COALESCE(SUM(d.amount_usd), 0) - COALESCE(SUM(w.amount), 0), 2) as calculated_balance,
    CASE 
        WHEN ROUND(u.balance, 2) = ROUND(COALESCE(SUM(d.amount_usd), 0) - COALESCE(SUM(w.amount), 0), 2)
        THEN '✓ OK'
        ELSE '✗ MISMATCH'
    END as status
FROM users u
LEFT JOIN deposits d ON u.user_id = d.user_id AND d.status = 'confirmed'
LEFT JOIN withdrawals w ON u.user_id = w.user_id
WHERE u.balance > 0 OR COALESCE(SUM(d.amount_usd), 0) > 0
GROUP BY u.user_id
HAVING status = '✗ MISMATCH';

-- 10. Быстрая проверка на критические проблемы
SELECT 
    'CRITICAL' as level,
    'Negative balance' as issue,
    COUNT(*) as count
FROM users
WHERE balance < 0

UNION ALL

SELECT 
    'WARNING' as level,
    'Pending deposits over 1 hour' as issue,
    COUNT(*) as count
FROM deposits
WHERE status = 'pending' AND timestamp < (strftime('%s', 'now') - 3600)

UNION ALL

SELECT 
    'INFO' as level,
    'Total confirmed deposits' as issue,
    COUNT(*) as count
FROM deposits
WHERE status = 'confirmed';
