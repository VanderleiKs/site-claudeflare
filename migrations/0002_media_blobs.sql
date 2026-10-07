-- Armazenamento alternativo de imagens dentro do D1, usado quando o Worker NÃO tem
-- bucket R2 configurado (binding MEDIA ausente). Indicado para testes e sites pequenos.
CREATE TABLE IF NOT EXISTS media_blobs (
  storage_key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL
);
