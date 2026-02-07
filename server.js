// =====================
// server.js
// =====================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();
const corsOptions = {
  origin: "https://maison-puce.vercel.app", // frontend domain
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true, // if sending cookies/auth headers
};

app.use(cors(corsOptions));
app.use(express.json());

// =====================
// MongoDB Connection
// =====================
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(()=>console.log('MongoDB connected'))
.catch(err=>console.error(err));

// =====================
// Cloudinary Config
// =====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// =====================
// Product Schema
// =====================
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  mainImage: { type: String, required: true },   // main image for cards
  otherImages: { type: [String], default: [] },  // extra images for single product page
  description: { type: String },
  quantity: { type: Number, default: 0 },
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

// =====================
// Hero Image Schema
// =====================
const heroImageSchema = new mongoose.Schema({
  imageUrl: { type: String, required: true },
  isActive: { type: Boolean, default: false },
}, { timestamps: true });

const HeroImage = mongoose.model('HeroImage', heroImageSchema);

// =====================
// Multer Config
// =====================
const storage = multer.memoryStorage();
const upload = multer({ storage });

// =====================
// Helper: Upload to Cloudinary
// =====================
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'maison_products' },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

const uploadHeroToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'maison_hero' },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// =====================
// Routes
// =====================

// ---- Create Product ----
app.post('/api/products', upload.array('images', 5), async (req, res) => {
  try {
    const { name, category, price, description, quantity } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    // Upload all images to Cloudinary
    const uploadResults = await Promise.all(req.files.map(file => uploadToCloudinary(file.buffer)));

    const mainImage = uploadResults[0].secure_url;
    const otherImages = uploadResults.slice(1).map(r => r.secure_url);

    const newProduct = new Product({
      name,
      category,
      price: Number(price),
      quantity: quantity ? Number(quantity) : 0,
      description,
      mainImage,
      otherImages
    });

    await newProduct.save();
    res.status(201).json(newProduct);

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Get All Products ----
app.get('/api/products', async (req, res)=>{
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Delete Product ----
app.delete('/api/products/:id', async (req,res)=>{
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted' });
  } catch(err){
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Update Product ----
app.put('/api/products/:id', upload.array('images', 5), async (req,res)=>{
  try {
    const { name, category, price, description, quantity } = req.body;
    const updateData = { name, category, price: Number(price), description, quantity: Number(quantity) };

    if (req.files && req.files.length > 0) {
      // Upload all new images
      const uploadResults = await Promise.all(req.files.map(file => uploadToCloudinary(file.buffer)));
      updateData.mainImage = uploadResults[0].secure_url;
      updateData.otherImages = uploadResults.slice(1).map(r => r.secure_url);
    }

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(updatedProduct);

  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

//=====================
// HERO SECTION 
//=====================

//--- CREATE HERO -----
app.post('/api/hero-images', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const result = await uploadHeroToCloudinary(req.file.buffer);

    const hero = new HeroImage({
      imageUrl: result.secure_url,
      isActive: req.body.isActive === 'true' || req.body.isActive === true
    });

    await hero.save();
    res.status(201).json(hero);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

//----- FETCH HERO -----
app.get('/api/hero-images', async (req, res) => {
  try {
    const heroes = await HeroImage.find().sort({ createdAt: -1 });
    res.json(heroes);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

//---- ACTIVATE/DEACTIVATE HERO
app.patch('/api/hero-images/:id/toggle', async (req, res) => {
  try {
    const hero = await HeroImage.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: 'Hero image not found' });

    hero.isActive = !hero.isActive;
    await hero.save();

    res.json(hero);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

//---- DELETE HERO----
app.delete('/api/hero-images/:id', async (req, res) => {
  try {
    await HeroImage.findByIdAndDelete(req.params.id);
    res.json({ message: 'Hero image deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// =====================
// Start Server
// =====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));