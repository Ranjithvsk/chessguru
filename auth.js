const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

function getCol() {
  return mongoose.connection.db.collection('users');
}

async function register(req, res) {
  try {
    const {username, password, email} = req.body;
    if (!username || !password) return res.json({ok:false, error:'Username and password required.'});
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(username)) return res.json({ok:false, error:'Invalid username format.'});
    if (password.length < 6) return res.json({ok:false, error:'Password too short (min 6 chars).'});

    const col = getCol();
    const existing = await col.findOne({username: {$regex: new RegExp('^'+username+'$','i')}});
    if (existing) return res.json({ok:false, error:'Username already taken.'});

    const hash = await bcrypt.hash(password, 10);
    const doc = {
      _id: username.toLowerCase(),
      username,
      bpass: hash,
      email: email || null,
      createdAt: new Date()
    };
    await col.insertOne(doc);
    req.session.userId = doc._id;
    req.session.username = username;
    res.json({ok:true});
  } catch(e) {
    console.error('register error:', e.message);
    res.json({ok:false, error:'Server error.'});
  }
}

async function signin(req, res) {
  try {
    const {username, password, keep} = req.body;
    if (!username || !password) return res.json({ok:false, error:'Please fill in all fields.'});

    const col = getCol();
    const user = await col.findOne({
      $or:[
        {username: {$regex: new RegExp('^'+username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')}},
        {email: username.toLowerCase()}
      ]
    });

    if (!user) return res.json({ok:false, error:'Invalid username or password.'});

    // bpass may be stored as string, Buffer, or BSON Binary — normalize to string
    let hash = user.bpass;
    if (hash && typeof hash === 'object') {
      if (hash.buffer) hash = hash.buffer.toString('utf8');        // BSON Binary
      else if (Buffer.isBuffer(hash)) hash = hash.toString('utf8'); // Node Buffer
      else hash = String(hash);
    }
    if (!hash || typeof hash !== 'string') return res.json({ok:false, error:'Invalid username or password.'});

    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.json({ok:false, error:'Invalid username or password.'});

    req.session.userId = user._id;
    req.session.username = user.username;
    if (keep) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    res.json({ok:true});
  } catch(e) {
    console.error('signin error:', e.message);
    res.json({ok:false, error:'Server error.'});
  }
}

function me(req, res) {
  if (!req.session.userId) return res.json({loggedIn:false});
  res.json({loggedIn:true, username:req.session.username, userId:req.session.userId});
}

function logout(req, res) {
  req.session.destroy(() => res.json({ok:true}));
}

module.exports = {register, signin, me, logout};
