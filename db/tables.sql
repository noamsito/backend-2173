DO
$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stock_data') THEN
        CREATE DATABASE stock_data;
    END IF;
END
$$;

\c stock_data;

CREATE TABLE IF NOT EXISTS stocks (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50),
    price FLOAT,
    short_name VARCHAR(100),
    long_name VARCHAR(255),
    quantity INT,
    timestamp TIMESTAMP
);
