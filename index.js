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

// Request logging (Simple)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

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
    const paymentsCollection = database.collection("payments");

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

    // --- Stats API ---
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const totalWorkers = await usersCollection.countDocuments({
        role: "worker",
      });
      const totalBuyers = await usersCollection.countDocuments({
        role: "buyer",
      });
      const users = await usersCollection.find().toArray();
      const totalAvailableCoin = users.reduce(
        (sum, user) => sum + (user.coins || 0),
        0
      );
      const totalPayments = await withdrawalsCollection
        .aggregate([
          { $match: { status: "approved" } },
          { $group: { _id: null, total: { $sum: "$withdrawal_amount" } } },
        ])
        .toArray();

      res.send({
        totalWorkers,
        totalBuyers,
        totalAvailableCoin,
        totalPayments: totalPayments[0]?.total || 0,
      });
    });

    app.get(
      "/buyer-stats/:email",
      verifyToken,
      verifyBuyer,
      async (req, res) => {
        const email = req.params.email;
        const totalTaskCount = await tasksCollection.countDocuments({
          buyer_email: email,
        });
        const pendingTasks = await tasksCollection
          .aggregate([
            { $match: { buyer_email: email } },
            { $group: { _id: null, total: { $sum: "$required_workers" } } },
          ])
          .toArray();
        const totalPaymentPaid = await submissionsCollection
          .aggregate([
            { $match: { buyer_email: email, status: "approved" } },
            { $group: { _id: null, total: { $sum: "$payable_amount" } } },
          ])
          .toArray();

        res.send({
          totalTaskCount,
          pendingTaskCount: pendingTasks[0]?.total || 0,
          totalPaymentPaid: totalPaymentPaid[0]?.total || 0,
        });
      }
    );

    app.get(
      "/worker-stats/:email",
      verifyToken,
      verifyWorker,
      async (req, res) => {
        const email = req.params.email;
        const totalSubmission = await submissionsCollection.countDocuments({
          worker_email: email,
        });
        const pendingSubmission = await submissionsCollection.countDocuments({
          worker_email: email,
          status: "pending",
        });
        const totalEarning = await submissionsCollection
          .aggregate([
            { $match: { worker_email: email, status: "approved" } },
            { $group: { _id: null, total: { $sum: "$payable_amount" } } },
          ])
          .toArray();

        res.send({
          totalSubmission,
          pendingSubmission,
          totalEarning: totalEarning[0]?.total || 0,
        });
      }
    );

    // --- Users API ---
    app.get("/top-workers", async (req, res) => {
      const result = await usersCollection
        .find({ role: "worker" })
        .sort({ coins: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

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

    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: role } }
      );
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role, coins: user?.coins });
    });

    // --- Tasks API ---
    app.get("/tasks", verifyToken, async (req, res) => {
      const result = await tasksCollection
        .find({ required_workers: { $gt: 0 } })
        .toArray();
      res.send(result);
    });

    app.get("/tasks/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await tasksCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/my-tasks/:email", verifyToken, verifyBuyer, async (req, res) => {
      const email = req.params.email;
      const result = await tasksCollection
        .find({ buyer_email: email })
        .sort({ completion_date: -1 })
        .toArray();
      res.send(result);
    });

    app.post("/tasks", verifyToken, verifyBuyer, async (req, res) => {
      const task = req.body;
      const totalCost = task.required_workers * task.payable_amount;

      const user = await usersCollection.findOne({ email: task.buyer_email });
      if (user.coins < totalCost) {
        return res.status(400).send({ message: "Insufficient coins" });
      }

      const result = await tasksCollection.insertOne({
        ...task,
        task_title: task.title,
        task_detail: task.detail,
        task_image_url: task.image_url,
        // Remove redundant fields if necessary
      });

      // Deduct coins
      await usersCollection.updateOne(
        { email: task.buyer_email },
        { $inc: { coins: -totalCost } }
      );

      res.send(result);
    });

    app.delete("/tasks/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });

      if (!task) return res.status(404).send({ message: "Task not found" });

      // Calculate refill
      // Note: We refill for remaining spots.
      // If we want to be generous, we could also refill for pending submissions that will never be approved.
      const pendingCount = await submissionsCollection.countDocuments({
        task_id: id,
        status: "pending",
      });
      const refillAmount =
        (task.required_workers + pendingCount) * task.payable_amount;

      // Refill coins to buyer
      await usersCollection.updateOne(
        { email: task.buyer_email },
        { $inc: { coins: refillAmount } }
      );

      // Delete task and its submissions
      const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
      await submissionsCollection.deleteMany({ task_id: id });

      res.send(result);
    });

    // --- Submissions API ---
    app.get(
      "/submissions/to-review/:email",
      verifyToken,
      verifyBuyer,
      async (req, res) => {
        const email = req.params.email;
        const result = await submissionsCollection
          .find({ buyer_email: email, status: "pending" })
          .toArray();
        res.send(result);
      }
    );

    app.post("/submissions", verifyToken, verifyWorker, async (req, res) => {
      const submission = req.body;
      const result = await submissionsCollection.insertOne(submission);

      // Decrease required_workers
      await tasksCollection.updateOne(
        { _id: new ObjectId(submission.task_id) },
        { $inc: { required_workers: -1 } }
      );

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

    app.patch(
      "/submissions/:id",
      verifyToken,
      verifyBuyer,
      async (req, res) => {
        const id = req.params.id;
        const { status, payable_amount, workerEmail, buyerName, taskTitle } =
          req.body;
        const result = await submissionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status } }
        );

        if (status === "approved") {
          await usersCollection.updateOne(
            { email: workerEmail },
            { $inc: { coins: parseInt(payable_amount) } }
          );
        } else if (status === "rejected") {
          // We need task_id here. Let's assume it's passed or we fetch the submission.
          const submission = await submissionsCollection.findOne({
            _id: new ObjectId(id),
          });
          await tasksCollection.updateOne(
            { _id: new ObjectId(submission.task_id) },
            { $inc: { required_workers: 1 } }
          );
        }

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

    // --- Payments API ---
    app.post("/payments", verifyToken, verifyBuyer, async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);

      // Update user coins
      await usersCollection.updateOne(
        { email: payment.email },
        { $inc: { coins: parseInt(payment.coins) } }
      );

      res.send(result);
    });

    app.get("/payments/:email", verifyToken, verifyBuyer, async (req, res) => {
      const email = req.params.email;
      const result = await paymentsCollection
        .find({ email })
        .sort({ date: -1 })
        .toArray();
      res.send(result);
    });

    // --- Withdrawals API ---
    app.get(
      "/withdrawals/pending",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await withdrawalsCollection
          .find({ status: "pending" })
          .toArray();
        res.send(result);
      }
    );

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
        const result = await withdrawalsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status } }
        );

        if (status === "approved") {
          await usersCollection.updateOne(
            { email: workerEmail },
            { $inc: { coins: -parseInt(withdrawal_coin) } }
          );
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .send({ message: "Something went wrong!", error: err.message });
});
