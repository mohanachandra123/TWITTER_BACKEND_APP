const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const validatePassword = (password) => {
  return password.length < 6;
};

//Middleware Function

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// API 1

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    const createUserQuery = `
     INSERT INTO
      user (name,username,password,gender)
     VALUES
      (
       '${name}',
       '${username}',
       '${hashedPassword}',
       '${gender}'
      );`;
    if (validatePassword(password)) {
      response.status(400);
      response.send("Password is too short");
    } else {
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
  const id = await db.get(getUser);

  const getTweetsQuery = `
  SELECT user.username,tweet.tweet,tweet.date_time AS dateTime
  FROM follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id
  INNER JOIN user ON user.user_id = tweet.user_id
  WHERE 
  follower.follower_user_id = ${id.user_id}
  ORDER BY 
  tweet.date_time DESC
  LIMIT 4;
  `;

  const results = await db.all(getTweetsQuery);
  response.send(results);
});

//API 4

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
  const id = await db.get(getUser);

  const getFollowingQuery = `
  SELECT user.name 
  FROM
  follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE 
  follower.follower_user_id = ${id.user_id};`;

  const results = await db.all(getFollowingQuery);
  response.send(results);
});

//API 5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
  const id = await db.get(getUser);

  const getFollowersQuery = `
  SELECT user.name 
  FROM
  follower INNER JOIN user ON user.user_id = follower.follower_user_id
  WHERE 
  follower.following_user_id = ${id.user_id};`;

  const results = await db.all(getFollowersQuery);
  response.send(results);
});

//API 6

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;

  const { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
  const id = await db.get(getUser);

  const tweetsQuery = `
  SELECT * FROM tweet WHERE tweet_id = ${tweetId};
  `;

  const tweetResult = await db.get(tweetsQuery);

  const userFollowingQuery = `
  SELECT * FROM 
  follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${id.user_id};
  `;
  const userFollowers = await db.all(userFollowingQuery);

  if (
    userFollowers.some((item) => item.following_user_id === tweetResult.user_id)
  ) {
    //response
    const { tweet_id, date_time, tweet } = tweetResult;

    const getLikesCount = `
    
    SELECT COUNT(like_id) AS likes FROM like 
    WHERE tweet_id = ${tweet_id}
    GROUP BY tweet_id;`;

    const likesObj = await db.get(getLikesCount);

    const getRepliesCount = `
    SELECT COUNT(reply_id) AS replies FROM reply 
    WHERE tweet_id = ${tweet_id}
    GROUP BY tweet_id;
    `;

    const repliesObj = await db.get(getRepliesCount);

    response.send({
      tweet,
      likes: likesObj.likes,
      replies: repliesObj.replies,
      dateTime: date_time,
    });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
    const id = await db.get(getUser);

    const tweetsQuery = `
  SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
  WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${id.user_id};
  `;
    const tweetResult = await db.get(tweetsQuery);

    if (tweetResult === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikesQuery = `
        SELECT user.username
        FROM user INNER JOIN like ON like.user_id = user.user_id
        WHERE like.tweet_id = ${tweetId};
        `;

      const likesResult = await db.all(getLikesQuery);
      const likes = likesResult.map((user) => {
        return user["username"];
      });
      response.send({ likes });
    }
  }
);

//API 8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
    const id = await db.get(getUser);

    const tweetsQuery = `
  SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
  WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${id.user_id};
  `;
    const tweetResult = await db.get(tweetsQuery);

    if (tweetResult === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getResultQuery = `
        SELECT user.name, reply.reply 
        FROM user INNER JOIN reply ON user.user_id = reply.user_id
        WHERE reply.tweet_id = ${tweetId};
        `;

      const replies = await db.all(getResultQuery);
      response.send({ replies });
    }
  }
);

//API 9

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`;
  const id = await db.get(getUser);

  const getTweetsQuery = `
  SELECT tweet, (SELECT COUNT(like_id) FROM like WHERE tweet_id = tweet.tweet_id) AS likes,
  (SELECT COUNT(reply_id) FROM reply WHERE tweet_id = tweet.tweet_id) AS replies,
  date_time AS dateTime
  FROM tweet 
  WHERE user_id = ${id.user_id};
  `;
  const result = await db.all(getTweetsQuery);
  response.send(result);
});

//API 10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const date = new Date();
  const getUser = `SELECT user_id FROM user WHERE username = '${username}'`;
  const id = await db.get(getUser);

  const createTweetQuery = `
    INSERT INTO 
    tweet (tweet,user_id,date_time)
    VALUES ('${tweet}',${id.user_id},'${date}');
    `;

  const result = await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API 11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUser = `SELECT user_id FROM user WHERE username = '${username}'`;
    const id = await db.get(getUser);

    const userTweets = `
    SELECT * FROM tweet WHERE tweet_id = ${tweetId};
    `;
    const tweetResult = await db.get(userTweets);
    const { user_id } = tweetResult;

    if (user_id === id.user_id) {
      const deleteQuery = `
        DELETE FROM tweet 
        WHERE tweet_id = ${tweetId};
        `;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
module.exports = app;
