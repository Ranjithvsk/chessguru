const rateLimit=require('express-rate-limit');
const limiter=rateLimit({windowMs:60*1000,max:60,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests, please wait 1 minute'}});
const authLimiter=rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false,message:{error:'Too many attempts, try again later'}});
const express=require("express"),mongoose=require("mongoose"),cors=require("cors"),helmet=require("helmet");
const session=require("express-session");
const MongoStore=require("connect-mongo").default;
const {register,signin,me,logout}=require("./auth");
require("dotenv").config();
const app=express(),PORT=process.env.PORT||3000;
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(cors({origin:true,credentials:true}));
app.use(express.json());
mongoose.connect("mongodb://localhost:27017/chessguru").then(()=>{
  console.log("MongoDB connected");
  app.use(session({
    secret:process.env.SESSION_SECRET||'cg_super_secret_2026',
    resave:false,
    saveUninitialized:false,
    store:MongoStore.create({mongoUrl:'mongodb://localhost:27017/chessguru',ttl:30*24*60*60}),
    cookie:{secure:false,maxAge:7*24*60*60*1000}
  }));
  const routes=require("./routes");
  
app.get('/engine-battle',(req,res)=>res.sendFile(__dirname+'/public/engine_battle.html'));
app.get('/opening',(req,res)=>res.sendFile(__dirname+'/public/opening.html'));
app.use(express.static("public"));
  // Auth endpoints
  app.post('/auth/register', authLimiter, register);
  app.post('/auth/signin',   authLimiter, signin);
  app.get('/auth/me',        me);
  app.post('/auth/logout',   logout);
  // Login page
  app.get('/login',(req,res)=>res.sendFile(__dirname+'/public/login.html'));
  app.use("/api",limiter,routes);
  app.get('/blindfold',(req,res)=>res.sendFile(__dirname+'/public/blindfold.html'));
  app.get("/*splat",(req,res)=>res.sendFile(__dirname+"/public/index.html"));
  app.listen(PORT,()=>console.log("ChessGuru API v2 on port "+PORT));
}).catch(err=>console.log("MongoDB error:",err));
