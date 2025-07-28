const express = require('express');
const app = express();
const pool = require('./db/db');
const path = require('path');
require('dotenv').config();
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const fs = require('fs');
// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true
            });
        }
        cb(null, dir);
    }
    , filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({
    storage
});
app.set('view engine', 'ejs');
app.use(express.urlencoded({
    extended: true
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'yourSecretKey'
    , resave: false
    , saveUninitialized: true
}));
app.use(flash());
// Home Page with Sort, Filter, and Pagination
app.get('/', async(req, res) => {
    const sortBy = req.query.sort || 'date';
    const filterRating = parseInt(req.query.filterRating) || null;
    const category = req.query.category || null;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    let sortColumn = 'date_read DESC';
    if (sortBy === 'rating') sortColumn = 'rating DESC';
    if (sortBy === 'title') sortColumn = 'title ASC';
    try {
        let countQuery = 'SELECT COUNT(*) FROM books';
        let dataQuery = `SELECT * FROM books`;
        const params = [];
        let whereClauses = [];
        if (filterRating) {
            whereClauses.push(`rating >= $${params.length + 1}`);
            params.push(filterRating);
        }
        if (category) {
            whereClauses.push(`category = $${params.length + 1}`);
            params.push(category);
        }
        if (whereClauses.length > 0) {
            const whereString = ' WHERE ' + whereClauses.join(' AND ');
            countQuery += whereString;
            dataQuery += whereString;
        }
        dataQuery += ` ORDER BY ${sortColumn} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const totalResult = await pool.query(countQuery, params.slice(0, params.length - 2));
        const totalBooks = parseInt(totalResult.rows[0].count);
        if (totalBooks === 0) {
            req.flash('error', 'No books found matching the selected filters.');
            return res.redirect('/');
        }
        const totalPages = Math.ceil(totalBooks / limit);
        const result = await pool.query(dataQuery, params);
        const books = result.rows.map(book => ({...book, title: book.title, author: book.author, category: book.category
        }));
        const catResult = await pool.query('SELECT DISTINCT category FROM books WHERE category IS NOT NULL');
        const categoryList = catResult.rows.map(row => row.category);
        res.render('index', {
            books, searchTerm: null, sortBy, filterRating, currentPage: page, totalPages, messages: req.flash(), categories: categoryList, currentCategory: category
        });
    }
    catch (err) {
        console.error(err.message);
        res.send('Error loading books');
    }
});
app.get('/add', (req, res) => {
    res.render('add');
});
// Add Book Submission
app.post('/add', upload.single('cover_file'), async(req, res) => {
    let {
        title, author, rating, notes, date_read, cover_id, category, category_other
    } = req.body;
    if (category === "Other" && category_other) {
        category = category_other;
    }
    let finalCoverId = cover_id;
    try {
        if (req.file) {
            finalCoverId = '/uploads/' + req.file.filename;
        }
        await pool.query('INSERT INTO books (title, author, rating, notes, date_read, cover_id, category) VALUES ($1, $2, $3, $4, $5, $6, $7)', [title, author, rating, notes, date_read, finalCoverId, category]);
        req.flash('success', 'Book added successfully!');
        res.redirect('/');
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error adding book!');
        res.redirect('/');
    }
});
// Search Route with Pagination and Flash if no result
app.get('/search', async(req, res) => {
    const query = req.query.q;
    const sortBy = req.query.sort || 'date';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    let sortColumn = 'date_read DESC';
    if (sortBy === 'rating') sortColumn = 'rating DESC';
    if (sortBy === 'title') sortColumn = 'title ASC';
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM books WHERE LOWER(title) LIKE LOWER($1) OR LOWER(author) LIKE LOWER($1)', [`%${query}%`]);
        const totalBooks = parseInt(totalResult.rows[0].count);
        const totalPages = Math.ceil(totalBooks / limit);
        if (totalBooks === 0) {
            req.flash('error', `No books found matching "${query}"`);
            return res.redirect('/');
        }
        const result = await pool.query(`SELECT * FROM books WHERE LOWER(title) LIKE LOWER($1) OR LOWER(author) LIKE LOWER($1) ORDER BY ${sortColumn} LIMIT $2 OFFSET $3`, [`%${query}%`, limit, offset]);
        const catResult = await pool.query('SELECT DISTINCT category FROM books WHERE category IS NOT NULL');
        const categoryList = catResult.rows.map(row => row.category);
        const books = result.rows.map(book => ({...book
            , title: book.title
                , author: book.author
        }));
        res.render('index', {
            books
            , searchTerm: query
                , sortBy
                , filterRating: null
                , currentPage: page
                , totalPages
                , messages: req.flash()
                , categories: categoryList
                , currentCategory: null // Or filter value if needed
        });
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error searching for books!');
        res.redirect('/');
    }
});
// Edit Book Form
app.get('/edit/:id', async(req, res) => {
    const {
        id
    } = req.params;
    try {
        const result = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            req.flash('error', 'Book not found!');
            return res.redirect('/');
        }
        res.render('edit', {
            book: result.rows[0]
        });
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error loading book!');
        res.redirect('/');
    }
});
// Edit Book Submission
app.post('/edit/:id', upload.single('cover_file'), async(req, res) => {
    const {
        id
    } = req.params;
    let {
        title, author, rating, notes, date_read, cover_id, category, category_other
    } = req.body;
    if (category === "Other" && category_other) {
        category = category_other;
    }
    let finalCoverId = cover_id;
    try {
        if (req.file) {
            finalCoverId = '/uploads/' + req.file.filename;
        }
        await pool.query('UPDATE books SET title=$1, author=$2, rating=$3, notes=$4, date_read=$5, cover_id=$6, category=$7 WHERE id=$8', [title, author, rating, notes, date_read, finalCoverId, category, id]);
        req.flash('success', 'Book updated successfully!');
        res.redirect('/');
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error updating book!');
        res.redirect('/');
    }
});
// Delete Book
app.post('/delete/:id', async(req, res) => {
    const {
        id
    } = req.params;
    try {
        await pool.query('DELETE FROM books WHERE id = $1', [id]);
        res.redirect('/');
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error deleting book!');
        res.redirect('/');
    }
});
app.get('/book/:id', async(req, res) => {
    const {
        id
    } = req.params;
    try {
        const result = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            req.flash('error', 'Book not found!');
            return res.redirect('/');
        }
        const book = result.rows[0];
        res.render('bookDetails', {
            book
        });
    }
    catch (err) {
        console.error(err.message);
        req.flash('error', 'Error loading review!');
        res.redirect('/');
    }
});
// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});