# Setting Up Social Features

## Step 1: Run Database Migrations

1. Open your **Supabase Dashboard** at [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Navigate to your project
3. Go to **SQL Editor** in the left sidebar
4. Copy the entire contents of `server/migrations.sql`
5. Paste into the SQL Editor
6. Click **Run** to execute the migrations

This will create:
- `profiles` table for user profiles
- `friendships` table for friend connections
- `friend_requests` table for friend requests
- Indexes for performance
- Row Level Security (RLS) policies
- Triggers for automatic friendship creation

## Step 2: Create Storage Bucket for Profile Pictures

1. In your Supabase Dashboard, go to **Storage**
2. Click **New bucket**
3. Name it: `profile-pictures`
4. Make it **Public**
5. Set allowed MIME types: `image/jpeg, image/png, image/webp, image/gif`
6. Set max file size: **5MB**
7. Click **Create bucket**

## Step 3: Verify Setup

Once migrations are run and storage is configured:

1. Restart your Replit server (if needed)
2. Test the profile endpoints:
   - `GET /api/profile` - Should return null for new users
   - `POST /api/profile` - Create a profile
3. Test friend request flow:
   - Search for users
   - Send friend requests
   - Accept/reject requests

## Backend API Endpoints

All endpoints require authentication (session cookie).

### Profile
- `GET /api/profile` - Get current user's profile
- `POST /api/profile` - Create/update profile (username, bio, tags, profile_picture_url)
- `POST /api/profile/status` - Update online status

### Users & Friends
- `GET /api/users/search?q=username` - Search users by username
- `GET /api/friends` - Get friends list (sorted by online status)
- `POST /api/friends/request` - Send friend request
- `GET /api/friends/requests` - Get pending requests
- `POST /api/friends/accept` - Accept friend request
- `POST /api/friends/reject` - Reject/delete friend request

## Next Steps

After database setup, the frontend pages need to be built:
1. Profile creation/editing page
2. Find People search page  
3. My People friends list page
4. Call notification system
