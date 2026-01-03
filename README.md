# Micro-Task and Earning Platform - Server

The backend API powering the Micro-Task platform, built with Node.js, Express, and MongoDB. Handles authentication, task processing, payment logic, and notification management.

## 🚀 Server Live URL

[Server Live URL](https://micro-task-server.vercel.app) (Replace with actual deployment URL)

## ✨ Key Functionalities

- **JWT Authentication**: Secure API endpoints with JSON Web Tokens.
- **Role-Based Middleware**: Specialized middleware to verify User roles (Admin, Buyer, Worker).
- **MongoDB Integration**: Robust data storage for users, tasks, submissions, payments, and notifications.
- **Transaction Safety**: Atomic-like updates for coin balances during task creation, approval, and withdrawals.
- **Cloud Image Uploads**: Integration with imgBB via client for task and user assets.
- **Stripe Integration**: Secure payment processing for purchasing coins (soon).
- **Real-time Stats**: Aggregated statistics for dashboards (Total earning, Pending tasks, User counts).

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Atlas)
- **Security**: JWT (jsonwebtoken) & CSRF protection (via cookie-parser/cors).
- **Environment**: Dotenv for sensitive key management.

## 📦 API Endpoints Overview

### Auth / JWT

- `POST /jwt`: Generate access token for authenticated users.

### Users

- `GET /users`: List all users (Admin only).
- `POST /users`: Save new user information.
- `PATCH /users/role/:id`: Update user role (Admin only).
- `DELETE /users/:id`: Remove user (Admin only).

### Tasks

- `GET /tasks`: List active tasks.
- `POST /tasks`: Create new task & deduct coins (Buyer only).
- `DELETE /tasks/:id`: Delete task & refill coins.

### Submissions

- `POST /submissions`: Submit task proof (Worker only).
- `PATCH /submissions/:id`: Approve/Reject submissions (Buyer only).

### Stats

- `GET /admin-stats`: System-wide stats for Admin.
- `GET /buyer-stats/:email`: Performance stats for Buyers.
- `GET /worker-stats/:email`: Earning stats for Workers.

## 🛠️ Environment Variables

Create a `.env` file in the root directory:

```env
DB_USER=your_mongodb_username
DB_PASS=your_mongodb_password
ACCESS_TOKEN_SECRET=your_jwt_secret_key
STRIPE_SECRET_KEY=your_stripe_secret
```

## 📦 Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Start the server**:
   ```bash
   npm start
   ```
   For development:
   ```bash
   npm run dev
   ```
