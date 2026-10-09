# RoboBench

## Run the frontend
1. `cd frontend`
2. `cp .env.example .env` and paste your Firebase web app config values
3. `npm install`
4. `npm run dev` then open http://localhost:5173

## Firebase console checklist
- Build > Authentication > Sign-in method > enable Email/Password
- Build > Firestore Database > Rules > paste `firebase/firestore.rules` > Publish
- First load of the leaderboard may show an error with a link; ignore unless it mentions an index.
