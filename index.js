const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173"], // Update with production URL
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lwmsv9d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const database = client.db("microTaskDB");
    const usersCollection = database.collection("users");
    const tasksCollection = database.collection("tasks");
    const submissionsCollection = database.collection("submissions");
    const notificationsCollection = database.collection("notifications");
    const withdrawalsCollection = database.collection("withdrawals");

    // --- JWT & Auth Middlewares ---

    // Verify Token
    const verifyToken = (req, res, next) => {
      const authorization = req.headers.authorization;
      if (!authorization) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      const token = authorization.split(" ")[1];
      jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET || "secret",
        (err, decoded) => {
          if (err) {
            return res.status(401).send({ message: "Unauthorized Access" });
          }
          req.decoded = decoded;
          next();
        }
      );
    };

    // Role Verification Helper
    const verifyRole = (role) => async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== role) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    const verifyAdmin = verifyRole("admin");
    const verifyBuyer = verifyRole("buyer");
    const verifyWorker = verifyRole("worker");

    // --- JWT Generate ---
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(
        user,
        process.env.ACCESS_TOKEN_SECRET || "secret",
        { expiresIn: "1h" }
      );
      res.send({ token });
    });

    // --- Helper: Create Notification ---
    const createNotification = async (toEmail, message, actionRoute) => {
      const notification = {
        message,
        toEmail,
        actionRoute,
        time: new Date(),
        isRead: false,
      };
      await notificationsCollection.insertOne(notification);
    };

    // --- Users API ---
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role });
    });

    // --- Tasks API ---
    app.post("/tasks", verifyToken, verifyBuyer, async (req, res) => {
      const task = req.body;
      const result = await tasksCollection.insertOne(task);
      res.send(result);
    });

    // --- Submissions API ---
    app.post("/submissions", verifyToken, verifyWorker, async (req, res) => {
      const submission = req.body;
      const result = await submissionsCollection.insertOne(submission);

      // Notify Buyer
      const message = `${submission.worker_name} has submitted work for ${submission.task_title}`;
      await createNotification(
        submission.buyer_email,
        message,
        "/dashboard/buyer-home"
      );

      res.send(result);
    });

    app.get("/my-submissions", verifyToken, verifyWorker, async (req, res) => {
      const email = req.query.email;
      const page = parseInt(req.query.page) || 1;
      const size = parseInt(req.query.size) || 10;

      const query = { worker_email: email };
      const total = await submissionsCollection.countDocuments(query);
      const result = await submissionsCollection
        .find(query)
        .sort({ current_date: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .toArray();

      res.send({ total, result });
    });

    // Approve/Reject Submission (Buyer)
    app.patch(
      "/submissions/:id",
      verifyToken,
      verifyBuyer,
      async (req, res) => {
        const id = req.params.id;
        const { status, payable_amount, workerEmail, buyerName, taskTitle } =
          req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: status } };

        const result = await submissionsCollection.updateOne(filter, updateDoc);

        if (status === "approved") {
          await usersCollection.updateOne(
            { email: workerEmail },
            { $inc: { coins: parseInt(payable_amount) } }
          );
        }

        // Add Notification
        const message =
          status === "approved"
            ? `You have earned 🪙 ${payable_amount} from ${buyerName} for completing ${taskTitle}`
            : `Your submission for ${taskTitle} was rejected by ${buyerName}`;

        await createNotification(
          workerEmail,
          message,
          "/dashboard/worker-home"
        );
        res.send(result);
      }
    );

    // --- Withdrawals API ---
    app.post("/withdrawals", verifyToken, verifyWorker, async (req, res) => {
      const withdrawal = req.body;
      const result = await withdrawalsCollection.insertOne(withdrawal);
      res.send(result);
    });

    app.patch(
      "/withdrawals/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status, workerEmail, withdrawal_coin } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: status } };

        const result = await withdrawalsCollection.updateOne(filter, updateDoc);

        if (status === "approved") {
          // Decrease user coin
          await usersCollection.updateOne(
            { email: workerEmail },
            { $inc: { coins: -parseInt(withdrawal_coin) } }
          );

          // Notify Worker
          const message = `Admin approved your withdrawal request of ${withdrawal_coin} coins`;
          await createNotification(
            workerEmail,
            message,
            "/dashboard/worker-home"
          );
        }

        res.send(result);
      }
    );

    // --- Notifications API ---
    app.get("/notifications/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await notificationsCollection
        .find({ toEmail: email })
        .sort({ time: -1 })
        .toArray();
      res.send(result);
    });

    console.log("Connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Micro Task Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
