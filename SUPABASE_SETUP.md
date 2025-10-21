# Supabase Database Setup

This project uses Supabase as the database. You need to add the following columns to your `profiles` table via the Supabase SQL Editor.

## Required Database Changes

### 1. Add Push Subscription Column

This column stores web push notification subscriptions for each user.

```sql
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS push_subscription JSONB;
```

### 2. Add Avatar URL Column

This column stores the Ready Player Me avatar URL for each user.

```sql
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

## How to Apply These Changes

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste both ALTER TABLE statements above
5. Click **Run** or press `Ctrl/Cmd + Enter`

## Verification

After running the SQL, verify the columns were added:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles';
```

You should see `push_subscription` (jsonb) and `avatar_url` (text) in the results.

## What These Columns Are For

- **`push_subscription`**: Stores browser push notification endpoint data so users can receive call notifications even when they're on different pages or the app is in the background
- **`avatar_url`**: Stores the Ready Player Me avatar GLB model URL (e.g., `https://models.readyplayer.me/[avatar-id].glb`) which is loaded during AR Holo Mode calls
