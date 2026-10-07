import type { MigrationFile } from './migrator';
// Conteúdo dos arquivos .sql embutido no bundle do Worker (loader "text" em angular.json).
import init from '../../../migrations/0001_init.sql';
import mediaBlobs from '../../../migrations/0002_media_blobs.sql';

/** Migrations embutidas no Worker. Ao criar um arquivo novo em migrations/, registre-o aqui. */
export const MIGRATION_FILES: readonly MigrationFile[] = [
  { name: '0001_init.sql', sql: init },
  { name: '0002_media_blobs.sql', sql: mediaBlobs },
];
