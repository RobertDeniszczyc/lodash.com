'use strict';

const _ = require('lodash');
const fetch = require('node-fetch');
const globby = require('globby');
const gulp = require('gulp');
const pump = require('pump');
const sri = require('sri-toolbox');
const toIco = require('to-ico');

const pify = require('pify');
const fs = pify(require('fs'));

const babel = require('gulp-babel');
const cssnano = require('gulp-cssnano');
const htmlmin = require('gulp-htmlmin');
const imagemin = require('gulp-imagemin');
const jsonmin = require('gulp-jsonmin');
const purify = require('gulp-purifycss');
const responsive = require('gulp-responsive');
const sequence = require('gulp-sequence');
const uglify = require('gulp-uglify');

const base = './';
const icons = require('./icons');
const opts = { base };

const cb = e => e && console.log(e.message);
const readSource = file => fs.readFile(file, 'utf8');

const plugins = {
  'babel': {
    'comments': false,
    'presets': ['babili']
  },

  'htmlmin': (() => {
    const html = {
      'collapseBooleanAttributes': true,
      'collapseWhitespace': true,
      'decodeEntities': true,
      'includeAutoGeneratedTags': false,
      'removeAttributeQuotes': true,
      'removeComments': true,
      'removeEmptyAttributes': true,
      'removeOptionalTags': true,
      'removeRedundantAttributes': true,
      'removeScriptTypeAttributes': true,
      'removeStyleLinkTypeAttributes': true,
      'sortAttributes': true,
      'sortClassName': true,
      'useShortDoctype': true
    };

    const xml = _.defaults({
      'html5': false,
      'removeAttributeQuotes': false
    }, html);

    return { html, xml };
  })(),

  'imagemin': [
    imagemin.optipng({
      'optimizationLevel': 7
    }),
    imagemin.svgo({
      'floatPrecision': 1,
      'plugins': [
        { 'removeDimensions': true },
        { 'removeTitle': true }
      ]
    })
  ],

  'purify': {
    'rejected': true
  },

  'responsive': {
    'errorOnEnlargement': false,
    'errorOnUnusedImage': false,
    'silent': true,
    'stats': false,
    'withoutEnlargement': false
  },

  'uglify': {
    'compress': {
      'collapse_vars': true,
      'negate_iife': false,
      'pure_getters': true,
      'unsafe': true,
      'warnings': false
    }
  }
};

/**
 * Cleanup whitespace of file at `filePath`.
 *
 * @private
 * @param {string} filePath The path of the file to clean.
 * @returns {Promise} Returns the cleanup promise.
 */
function cleanFile(filePath) {
  return readSource(filePath)
    .then(source => fs.writeFile(filePath, cleanSource(source)));
}

/**
 * Cleanup whitespace of `source`.
 *
 * @private
 * @param {string} source The source to clean.
 * @returns {string} Returns the cleaned source.
 */
function cleanSource(source) {
  return source
    // Trim whitespace.
    .trim()
    // Consolidate multiple newlines.
    .replace(/^(?:\s*\n){2,}/gm, '\n')
    // Consolidate spaces.
    .replace(/ {2,}/g, ' ')
    // Repair indentation.
    .replace(/^ (?=[-\w]+:)/gm, '  ') +
    // Add trailing newline.
    '\n';
}

/*----------------------------------------------------------------------------*/

gulp.task('build-config', () =>
  readSource('_config.yml').then(config => {
    const entries = [];
    config.replace(/^[\t ]*(?:-[\t ]*)?href:[\t ]*(\S+)\n[\t ]*integrity:[\t ]*(\S+)/gm, (match, href, integrity) =>
      entries.push({ href, integrity })
    );
    return Promise.all(entries.map(({ href }) => fetch(href)))
      .then(respes => Promise.all(respes.map(resp => resp.text())))
      .then(bodies => fs.writeFile('_config.yml', bodies.reduce((config, body, index) =>
        config.replace(entries[index].integrity, sri.generate({ 'algorithms': ['sha384'] }, body))
      , config)));
  })
);

/*----------------------------------------------------------------------------*/

gulp.task('build-app-icons', () =>
  pump([
    gulp.src(['**/*.{png,svg}', '!node_modules/**/*', '!_site/**/*'], opts),
    responsive(icons, plugins.responsive),
    gulp.dest('_site/icons/')
  ], cb)
);

gulp.task('build-css', ['minify-css']);

gulp.task('build-favicon', () =>
  globby('_site/icons/favicon-*.png')
    .then(files => Promise.all(files.map(file => fs.readFile(file))))
    .then(toIco)
    .then(buffer => fs.writeFile('_site/favicon.ico', buffer))
);

gulp.task('build-headers', () => cleanFile('_site/_headers'));

gulp.task('build-html', ['minify-html']);

gulp.task('build-images', sequence('build-app-icons', 'build-favicon', 'minify-images'));

gulp.task('build-js', sequence('build-sw', ['minify-js', 'minify-sw']));

gulp.task('build-metadata', ['minify-json', 'minify-xml']);

gulp.task('build-redirects', () => cleanFile('_site/_redirects'));

gulp.task('build-sw', () =>
  Promise.all(['_site/_redirects', '_site/sw.js'].map(readSource))
    .then(({ 0:_redirects, 1:sw }) => {
      const entries = [];
      _redirects.replace(/^[\t ]*(\S+)[\t ]+(\S+)(?:[\t ]+(\S+))?/gm, (match, from, to, status) => {
        from = _.escapeRegExp(from)
          // Replace escaped asterisks with greedy dot capture groups.
          .replace(/\\\*/g, '(.*)')
          // Make trailing slashes optional.
          .replace(/\/$/, '(?:/.|/?$)')
          // Escape forward slashes.
          .replace(/\//g, '\\/');

        entries.push(`[/^${ from }/,'${ to }',${ status }]`);
      });
      return fs.writeFile('_site/sw.js', sw.replace('/*insert_redirect*/', entries.join(',')));
    })
);

/*----------------------------------------------------------------------------*/

gulp.task('minify-css', () =>
  pump([
    gulp.src('_site/**/*.css', opts),
    purify(['_site/**/*.html', '_site/assets/**/*.js'], plugins.purify),
    cssnano(),
    gulp.dest(base)
  ])
);

gulp.task('minify-html', () =>
  pump([
    gulp.src('_site/**/*.html', opts),
    htmlmin(plugins.htmlmin.html),
    gulp.dest(base)
  ], cb)
);

gulp.task('minify-images', () =>
  pump([
    gulp.src('_site/**/*.{png,svg}', opts),
    imagemin(plugins.imagemin),
    gulp.dest(base)
  ], cb)
);

gulp.task('minify-js', () =>
  pump([
    gulp.src(['_site/**/*.js', '!_site/sw.js'], opts),
    uglify(plugins.uglify),
    gulp.dest(base)
  ], cb)
);

gulp.task('minify-json', () =>
  pump([
    gulp.src('_site/**/*.json', opts),
    jsonmin(),
    gulp.dest(base)
  ], cb)
);

gulp.task('minify-sw', () =>
  pump([
    gulp.src('_site/sw.js', opts),
    babel(plugins.babel),
    gulp.dest(base)
  ], cb)
);

gulp.task('minify-xml', () =>
  pump([
    gulp.src('_site/**/*.xml', opts),
    htmlmin(plugins.htmlmin.xml),
    gulp.dest(base)
  ], cb)
);

/*----------------------------------------------------------------------------*/

gulp.task('build', sequence(
  ['build-headers', 'build-metadata', 'build-redirects'],
  ['build-css', 'build-html', 'build-images', 'build-js']
));
