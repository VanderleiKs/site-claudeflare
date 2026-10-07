import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '../../shared/models';
import type { AppEnv } from '../app-env';
import { HttpError } from '../http/errors';
import { idSchema, parseBody } from '../http/validation';

const decode = (value: string | undefined) => {
  try {
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
};

/**
 * Upload: o painel envia o arquivo como corpo binário (Content-Type da imagem), sem multipart.
 * O tamanho é limitado antes da leitura do corpo.
 */
export const mediaRoutes = new Hono<AppEnv>()
  .post(
    '/',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: () => {
        throw new HttpError(413, 'A imagem deve ter no máximo 5 MB.');
      },
    }),
    async (c) => {
      const contentType = c.req.header('content-type')?.split(';')[0]?.trim() ?? '';
      if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
        throw new HttpError(415, 'Formato não suportado. Envie JPEG, PNG ou WebP.');
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const name = decode(c.req.header('x-file-name')) ?? 'imagem';
      const image = await c.var.services.media.upload(
        bytes,
        name,
        decode(c.req.header('x-image-alt')),
      );
      return c.json(image, 201);
    },
  )
  .delete('/:id', async (c) => {
    await c.var.services.media.delete(parseBody(idSchema, c.req.param('id')));
    return c.body(null, 204);
  });
