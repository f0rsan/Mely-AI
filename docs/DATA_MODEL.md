# Mely AI — 核心数据模型

## 概念关系

```
Character (角色)
  ├── CharacterDNA (外貌参数)
  ├── VisualAssets (视觉资产: LoRA + 触发词 + checkpoint)
  ├── VoiceAssets (声音资产: 参考音频 + 声纹嵌入)
  ├── Costume[] (造型版本树)
  │     ├── costume_lora (造型专属 LoRA)
  │     ├── costume_prompt (附加 Prompt)
  │     └── preview_images[] (预览图)
  └── Generation[] (生成历史)
        ├── params_snapshot (完整生成参数快照)
        ├── output_path (输出文件)
        └── tags[] (用途标签)
```

## SQLite Schema

### characters

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID, 创建时生成, 不可修改 |
| name | TEXT NOT NULL | 角色名（显示用） |
| created_at | TEXT NOT NULL | ISO 8601 时间戳 |
| fingerprint | TEXT | 角色 DNA + 训练数据哈希，用于创作溯源 |

### character_dna

| 字段 | 类型 | 说明 |
|------|------|------|
| character_id | TEXT PRIMARY KEY | FK → characters.id |
| hair_color | TEXT | 发色标签 |
| eye_color | TEXT | 瞳色标签 |
| skin_tone | TEXT | 肤色标签 |
| body_type | TEXT | 体型标签 |
| style | TEXT | 风格标签（二次元/写实/3D） |
| extra_tags | TEXT | JSON 数组, 其他描述标签 |
| auto_prompt | TEXT | 由 DNA 参数自动组合的基础 Prompt |

### visual_assets

| 字段 | 类型 | 说明 |
|------|------|------|
| character_id | TEXT PRIMARY KEY | FK → characters.id |
| lora_path | TEXT | LoRA 文件本地路径（加密存储） |
| trigger_word | TEXT | LoRA 触发词 |
| recommended_weight | REAL | 推荐 LoRA 权重 (0.0–1.0) |
| base_checkpoint | TEXT | 基础模型名称/路径 |
| training_config | TEXT | JSON, 训练参数快照 |
| training_status | TEXT | pending / training / completed / failed |
| training_progress | REAL | 0.0–1.0 |

### voice_assets

| 字段 | 类型 | 说明 |
|------|------|------|
| character_id | TEXT PRIMARY KEY | FK → characters.id |
| reference_audio_path | TEXT | 参考音频文件路径 |
| voiceprint_embedding | BLOB | 声纹嵌入向量 |
| tts_engine | TEXT | 使用的 TTS 引擎名称 |
| custom_model_path | TEXT | v1.5: 专属 TTS 模型路径 |

### costumes

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| character_id | TEXT NOT NULL | FK → characters.id |
| name | TEXT NOT NULL | 造型名（如「夏日泳装版」） |
| parent_id | TEXT | FK → costumes.id, null 为基础造型 |
| costume_lora | TEXT | 造型专属 LoRA 路径（可为空） |
| costume_prompt | TEXT NOT NULL | 造型附加 Prompt |
| created_at | TEXT NOT NULL | ISO 8601 |

### costume_previews

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| costume_id | TEXT NOT NULL | FK → costumes.id |
| image_path | TEXT NOT NULL | 预览图路径 |
| sort_order | INTEGER | 排序 |

### generations

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | UUID |
| character_id | TEXT NOT NULL | FK → characters.id |
| costume_id | TEXT NOT NULL | FK → costumes.id |
| type | TEXT NOT NULL | image / audio / video_frame |
| params_snapshot | TEXT NOT NULL | JSON, 完整生成参数（seed, steps, sampler, LoRA weight 等） |
| output_path | TEXT NOT NULL | 输出文件本地路径 |
| created_at | TEXT NOT NULL | ISO 8601 |

### generation_tags

| 字段 | 类型 | 说明 |
|------|------|------|
| generation_id | TEXT NOT NULL | FK → generations.id |
| tag | TEXT NOT NULL | 用途标签（封面图/表情包/周边/预告图等） |
| PRIMARY KEY | (generation_id, tag) | |

## 索引策略

```sql
CREATE INDEX idx_costumes_character ON costumes(character_id);
CREATE INDEX idx_costumes_parent ON costumes(parent_id);
CREATE INDEX idx_generations_character ON generations(character_id);
CREATE INDEX idx_generations_costume ON generations(costume_id);
CREATE INDEX idx_generations_type ON generations(type);
CREATE INDEX idx_generations_created ON generations(created_at DESC);
CREATE INDEX idx_generation_tags_tag ON generation_tags(tag);
```

## 文件系统布局

```
~/.mely/
├── db/
│   └── mely.db                    ← SQLite 数据库
├── characters/
│   └── {character_id}/
│       ├── lora/
│       │   └── {name}.safetensors ← 加密存储
│       ├── training_data/
│       │   └── *.png/jpg          ← 训练用参考图
│       ├── voice/
│       │   ├── reference.wav      ← 参考音频
│       │   └── voiceprint.npy     ← 声纹嵌入
│       ├── costumes/
│       │   └── {costume_id}/
│       │       └── previews/      ← 造型预览图
│       └── generations/
│           └── *.png/wav          ← 按日期组织
├── models/                        ← 按需下载的模型文件
│   ├── checkpoints/
│   ├── lora_base/
│   └── tts/
└── temp/                          ← 临时文件，定期清理
```
