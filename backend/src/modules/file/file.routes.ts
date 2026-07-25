import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { storageConfig } from '../../config/index.js';
import { authRequired, asyncHandler, ApiError } from '../../middleware/index.js';

const router = Router();

// 所有文件上传路由都需要登录
router.use(authRequired);

// 允许的图片扩展名
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

/** 获取用户专属上传目录 */
function getUserUploadDir(userId: string, sub: string): string {
  return path.join(storageConfig.dataPath, 'users', userId, 'uploads', sub);
}

function createUserUploadStorage(sub: string) {
  return multer.diskStorage({
    destination: async (req, _file, cb) => {
      const userId = (req as Request & { user?: { userId: string } }).user?.userId;
      if (!userId) { cb(new Error('Unauthorized'), ''); return; }
      const dir = getUserUploadDir(userId, sub);
      await fs.ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `${uuidv4()}${ext}`);
    },
  });
}

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    cb(new Error(`不支持的文件格式: ${ext}，仅支持 ${ALLOWED_EXTENSIONS.join(', ')}`));
    return;
  }
  if (!file.mimetype.startsWith('image/')) {
    cb(new Error('仅支持图片文件'));
    return;
  }
  cb(null, true);
}

const avatarUpload = multer({
  storage: createUserUploadStorage('avatars'),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const characterUpload = multer({
  storage: createUserUploadStorage('characters'),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * POST /api/files/avatar
 * 上传头像图片
 */
router.post(
  '/avatar',
  avatarUpload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.file) throw ApiError.badRequest('未选择文件');
    const url = `/uploads/${req.user.userId}/avatars/${req.file.filename}`;
    res.json({ success: true, data: { url } });
  }),
);

/**
 * POST /api/files/character
 * 上传角色图片
 */
router.post(
  '/character',
  characterUpload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!req.file) throw ApiError.badRequest('未选择文件');
    const url = `/uploads/${req.user.userId}/characters/${req.file.filename}`;
    res.json({ success: true, data: { url } });
  }),
);

/**
 * DELETE /api/files
 * 删除用户上传的文件（仅限本人 uploads 目录内的文件）
 */
router.delete(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { url } = req.body as { url?: string };
    if (!url) throw ApiError.badRequest('缺少 url 参数');

    // 解析相对路径，仅允许 /uploads/{userId}/... 格式
    const prefix = `/uploads/${req.user.userId}/`;
    if (!url.startsWith(prefix)) throw ApiError.forbidden('无权删除该文件');

    const relativePath = url.slice(prefix.length);
    // 路径穿越防护
    if (relativePath.includes('..') || path.isAbsolute(relativePath)) {
      throw ApiError.forbidden('非法路径');
    }

    const filePath = path.join(storageConfig.dataPath, 'users', req.user.userId, 'uploads', relativePath);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    res.json({ success: true, data: { message: '已删除' } });
  }),
);

export default router;
