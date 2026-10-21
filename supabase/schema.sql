CREATE TABLE IF NOT EXISTS "recipes" (
  "id" uuid NOT NULL PRIMARY KEY,
  "created_at" timestamptz NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "image_url" text,
  "category" text,
  "prep_time_minutes" integer,
  "cook_time_minutes" integer,
  "servings" integer
);
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
