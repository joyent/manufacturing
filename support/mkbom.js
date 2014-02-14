#! /usr/bin/env node

var util = require('util');
var fs = require('fs');
var path = require('path');

var fmt = util.format;
var w = process.stdout.write.bind(process.stdout);

var DEFMFG = 'joyent';
var files = [ 'manufacturers' ];
var directories = [ 'parts/270', 'parts/410', 'parts/540', 'parts/600',
    'parts/705', 'parts/770', 'parts/771', 'parts/772' ];
var parts = [];

function
fatal(msg)
{
	var c = path.basename(process.argv[1]);

	console.log('\n\n');
	console.error(c + ': ' + msg);
	process.exit(1);
}

function
read_data()
{
	var i, j;

	for (i = 0; i < files.length; i++) {
		var filename = files[i] + '.json';

		try {
			var str = fs.readFileSync(filename).toString();
			global[files[i]] = JSON.parse(str);
		} catch (err) {
			fatal('error in ' + filename + ': ' +
			    util.inspect(err.toString()));
		}
	}

	for (i = 0; i < directories.length; i++) {
		var dirents = fs.readdirSync(directories[i]);

		for (j = 0; j < dirents.length; j++) {
			var dirent = dirents[j];

			if (!dirent.match(/\.json$/))
				continue;

			var filename = './' + directories[i] + '/' + dirent;

			try {
				var f = fs.readFileSync(filename);
				var obj = JSON.parse(f.toString());
				obj.id = dirent.substr(0, dirent.length - 5);
				obj.dependencies = [];
				obj.dependents = [];
				assert_prop(filename, obj, 'pn');
				if (parts[obj.pn]) {
					fatal(filename + ' contains ' +
					    'duplicate part ' + obj.pn);
				}
				parts[obj.pn] = obj;
			} catch (err) {
				fatal('error in ' + filename + ': ' +
				    util.inspect(err.toString()));
			}
		}
	}
}

function
check_dependencies(pp, p)
{
	p.dependencies.forEach(function (c) {
		if (c == pp)
			fatal(pp.pn + ' circular dependency');
		check_dependencies(pp, c);
	});
}

function
topo_sort()
{
	var toplevel;

	Object.keys(parts).forEach(function (ppn) {
		var p = parts[ppn];

		if (!p.constituents)
			return;

		Object.keys(p.constituents).forEach(function (c) {
			if (parts[c]) {
				p.dependencies.push(parts[c]);
				parts[c].dependents.push(p);
			} else {
				var pn = c.split('-');
				var rootpn;

				if (pn.length < 3) {
					fatal('part number ' + p.pn +
					    ' depends on nonexistent ' + c);
				}
				if (pn.length > 3) {
					fatal('part number ' + p.pn +
					    ' depends on bogus ' + c);
				}

				rootpn = pn[0] + '-' + pn[1];

				if (!parts[rootpn]) {
					fatal('part number ' + p.pn +
					    ' depends on ' + c + ' but no ' +
					    ' root part ' + rootpn + ' exists');
				}
				if (!parts[rootpn].dashroll ||
				    parts[rootpn].dashroll != pn[2]) {
					fatal('part number ' + p.pn +
					    ' depends on "' + c + '" but ' +
					    rootpn + ' is at level ' +
					    parts[rootpn].dashroll);
				}
				if (!parts[rootpn].rev ||
				    parts[rootpn].rev < 50) {
					if (p.rev >= 50) {
						fatal('part number ' + p.pn +
						    ' is at rev ' + p.rev +
						    ' but depends on ' +
						    rootpn + ' at rev ' +
						    parts[rootpn].rev);
					}
				}

				p.dependencies.push(parts[rootpn]);
				parts[rootpn].dependents.push(p);
			}
		});
	});

	Object.keys(parts).forEach(function (ppn) {
		var p = parts[ppn];

		check_dependencies(p, p);
	});

	toplevel = Object.keys(parts).filter(function (ppn) {
		return (parts[ppn].dependents.length === 0);
	});

	return (toplevel.map(function (ppn) { return (parts[ppn]); }));
}

function
assert_prop(msg, obj, prop)
{
	if (obj.hasOwnProperty(prop))
		return;

	fatal(msg + ' ' + ' is missing required property ' + prop);
}

function
display_mfg(p)
{
	return (manufacturers[p.mfg ? p.mfg : DEFMFG].name);
}

function
display_mfgpn(p)
{
	if (p.mfgpn)
		return (p.mfgpn);
	return ('N/A');
}

function
full_pn(p)
{
	if (p.dashroll)
		return (p.pn + '-' + p.dashroll);
	return (p.pn);
}

function
root_pn(pn)
{
	var taxa = pn.split('-');

	if (taxa.length === 2)
		return (pn);

	if (taxa.length === 3)
		return (taxa[0] + '-' + taxa[1]);

	fatal('part number %s cannot be parsed', pn);
}

function
display_name(p)
{
	if (p.alias)
		return (fmt('%s [%s]', p.alias, p.desc));
	return (p.desc);
}

function
display_dashroll(p)
{
	if (p.dashroll)
		return (p.dashroll);
	return ('N/A');
}

function
display_rev(p)
{
	if (p.dashroll)
		return (p.rev);
	return ('N/A');
}

function
display_pn(p, full)
{
	var pn = full_pn(p);
	var dn;

	if (full === false) {
		dn = root_pn(pn);
	} else {
		dn = pn;
	}

	return (fmt('<a href="#%s">%s</a>', pn, dn));
}

function
dump_tree(p, level)
{
	p.dependencies.forEach(function (c) {
		var i, s = '';

		for (i = 0; i < 6; i++) {
			if (i == level) {
				s += fmt('|| %d ', p.constituents[full_pn(c)]);
			} else {
				s += '|| ';
			}
		}

		s += fmt('|| %s || %s || %s || %s ||\n',
		    display_pn(c), display_mfg(c), display_mfgpn(c), c.desc);
		w(s);
		dump_tree(c, level + 1);
	});
}

function
display_refs(p)
{
	var s = '';

	if (!p.ref)
		return ('N/A');

	if (Array.isArray(p.ref)) {
		p.ref.forEach(function (r) {
			s += fmt('<a href="%s">%s</a> ', r.uri, r.title);
		});
	} else {
		s = fmt('<a href="%s">%s</a> ', p.ref.uri, p.ref.title);
	}

	return (s);
}

w('<!-- DO NOT EDIT THIS FILE! It is automatically generated by ' +
    path.basename(process.argv[1]) + '-->\n\n');

read_data();

var toplevel = topo_sort();

w('# Top-Level Systems\n');

toplevel.forEach(function (p) {
	w(fmt('### %s\n', display_name(p)));
	w(fmt('**Description**: %s\n\n', p.desc));
	w('|| **Qty** || || || || || || **Part Number** || **Manufacturer** ' +
	    '|| **Mfg. Part Number** || **Description** ||\n');
	dump_tree(p, 0);
});

w('# Tabular Parts Listing\n');
w('|| **Part Number** || **Current Dashroll** || **Rev** || **Manufacturer** ' +
    '|| **Mfg. Part Number** || **Reference** || **Description** ||\n');
Object.keys(parts).sort().forEach(function (pn) {
	var p = parts[pn];

	w(fmt('|| %s || %s || %s || %s || %s || %s || %s ||\n',
	    display_pn(p, false), display_dashroll(p), display_rev(p),
	    display_mfg(p), display_mfgpn(p), display_refs(p), p.desc));
});

w('# Individual Parts Catalogue\n');
Object.keys(parts).sort().forEach(function (pn) {
	var p = parts[pn];

	w(fmt('### %s\n', full_pn(p)));
	w(fmt('* **Part Number**: %s\n', display_pn(p, false)));
	w(fmt('* **Dashroll**: %s\n', display_dashroll(p)));
	w(fmt('* **Revision**: %s\n', display_rev(p)));
	w(fmt('* **Manufacturer**: %s\n', display_mfg(p)));
	w(fmt('* **Manufacturer Part Number**: %s\n', display_mfgpn(p)));
	w(fmt('* **Description**: %s\n', p.desc));
	if (p.ref)
		w(fmt('* **Reference**: %s\n', display_refs(p)));
	if (p.alias)
		w(fmt('* **Short Description**: %s\n', p.alias));
	if (p.dependencies.length) {
		w(fmt('* **First-Level Contents**:\n'));
		p.dependencies.forEach(function (c) {
			var cpn = full_pn(c);
			w(fmt('\t* qty %d %s\n', p.constituents[cpn],
			    display_pn(c)));
		});
	}
	w('\n');
});

function
dump_dependents(p)
{
	p.dependents.forEach(function (c) {
		w(fmt('* %s\n', display_pn(c, false)));
		dump_dependents(c);
	});
}

w('# Dependents on Each Part\n');
Object.keys(parts).sort().forEach(function (pn) {
	var p = parts[pn];

	w(fmt('### Dependents on %s\n', display_pn(p)));
	dump_dependents(p);
	w('\n');
});

w('# Parts by Manufacturer\n');
Object.keys(manufacturers).forEach(function (mn) {
	var mfp = Object.keys(parts).filter(function (pn) {
		return (mn == (parts[pn].mfg ? parts[pn].mfg : 'joyent'));
	});

	w(fmt('### %s\n', manufacturers[mn].name));

	mfp.forEach(function (pn) {
		w(fmt('* %s\n', display_pn(parts[pn])));
	});

	w('\n');
});
